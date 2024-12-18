import * as _ from "lodash";
import {setTimeout} from "timers";
import {logger} from "./Logger";
import {config} from "../config";
import TimeService from "./TimeService";
import HardwareIOService from "./HardwareIOService";
import constants, {OutletState} from "../constants";
import {HardwareCommands} from "../types/commands";


class CommandService {
  private _commands: HardwareCommands = {};
  private _backgroundTaskRunning = false;

  async fetchAndProcessCommands(machineId: number, websocketService: any) {
    try {
      const {payload} = await websocketService.request({path: `/controllers/${machineId}/commands`});
      logger.info("Fetched commands from server");
      this.ingestCommands(payload);
    } catch (err) {
      logger.error("**** Error fetching commands");
      throw err;
    }
  }


  ingestCommands(newCommands: HardwareCommands) {
    const millisNow = TimeService.getTime();

    logger.debug(`ingestCommands: Merging old commands`);
    logger.debug(`${JSON.stringify(this._commands, null, 2)}`);
    logger.debug(`with new commands`);
    logger.debug(`${JSON.stringify(newCommands, null, 2)}`);

    //Merge new commands into existing commands
    config.OUTLETS.map(outlet => outlet.pin)
      .forEach((pinNumber) => {
        if(!_.has(newCommands, pinNumber)) {
          //TODO: Should turn outlet off here?
          return;
        }
        else if(!_.has(this._commands, pinNumber)) {
          this._commands[pinNumber] = newCommands[pinNumber];
          return;
        }

        const newCommandsStartTime = new Date(newCommands[pinNumber][0].time).getTime();
        const oldCommandsToKeep = _.dropRightWhile(this._commands[pinNumber], (command) => {
          if(new Date(command.time).getTime() >= newCommandsStartTime) {
            logger.debug(`ingestCommands: Discarding old command ${JSON.stringify(command, null, 2)} for pin ${pinNumber}`);
          }
          return new Date(command.time).getTime() >= newCommandsStartTime;
        });
        this._commands[pinNumber] = oldCommandsToKeep.concat(newCommands[pinNumber]);
      });

    logger.debug(`ingestCommands: Pruning`);
    logger.debug(JSON.stringify(this._commands, null, 2));
    logger.debug(`at time ${millisNow}`);

    this._commands = _.mapValues(this._commands, (commandList) => {
      const commandsWithoutOldCommands = _.dropWhile(commandList, (command, index) => {
        return index + 1 < commandList.length &&
          new Date(command.time).getTime() < millisNow &&
          new Date(commandList[index + 1].time).getTime() < millisNow;
      });

      // Remove the "isLast" flag on all commands except the last one
      _.initial(commandsWithoutOldCommands).forEach(command => _.unset(command, "isLast"));

      return commandsWithoutOldCommands;
    });

    logger.debug(`pruneCommands: Result is `);
    logger.debug(JSON.stringify(this._commands, null, 2));
  }


  refreshCommandsHint() {
    let nextRecommendedRefreshTimestamp = Number.MAX_SAFE_INTEGER;

    _.values(this._commands).forEach((commandsForOutlet) => {
      if (commandsForOutlet.some(command => command.isLast)) {
        return;
      }

      const lastCommand = _.last(commandsForOutlet);
      let lastCommandTime;

      if (!lastCommand) {
        // If we don't have any commands for this outlet, consider the last command time to be now.
        // This should force new commands to be fetched soon.
        lastCommandTime = TimeService.getTime();
      } else {
        lastCommandTime = new Date(lastCommand.time).getTime();
      }

      const recommendedRefreshTimeForOutlet = lastCommandTime - constants.COMMAND_REFRESH_LEAD_TIME_MS;
      nextRecommendedRefreshTimestamp = Math.min(nextRecommendedRefreshTimestamp, recommendedRefreshTimeForOutlet);
    });

    return nextRecommendedRefreshTimestamp;
  }


  getCommands() {
    return this._commands;
  }


  startBackgroundTask() {
    if(this._backgroundTaskRunning) return;

    logger.info("Starting pin switching task...");
    this._backgroundTaskRunning = true;

    const self = this;
    let nextExecutionTime = new Date().getTime(),
      executionInterval = 100;

    const task = function () {
      const now = TimeService.getTime();
      logger.debug(`Executing commands.  Time: ${now}`);

      config.OUTLETS.forEach((outlet) => {
        const commandsForOutlet = self._commands[outlet.pin];

        if(!commandsForOutlet) {
          HardwareIOService.setPinState(outlet.pin, OutletState.OFF);
          return;
        }

        let activeCommand = null;

        for(let i = 0; i < commandsForOutlet.length; i++) {
          const commandTime = new Date(commandsForOutlet[i].time).getTime();
          const nextCommandTime = i + 1 >= commandsForOutlet.length ?
            Number.MAX_SAFE_INTEGER :
            new Date(commandsForOutlet[i + 1].time).getTime();

          if(now >= commandTime && now < nextCommandTime) {
            activeCommand = commandsForOutlet[i];
          }
        }

        if(activeCommand) {
          switch (activeCommand.state) {
            case OutletState.OFF:
            case OutletState.ON:
              HardwareIOService.setPinState(outlet.pin, activeCommand.state);
              break;
            default:
              logger.error(`Command specifies an invalid outlet state: ${activeCommand}`);
              break;
          }
        }
        else {
          HardwareIOService.setPinState(outlet.pin, OutletState.OFF);
          return;
        }
      });

      nextExecutionTime += executionInterval;
      const delay = nextExecutionTime - new Date().getTime();
      setTimeout(task, delay);
    };

    task();
  }

}

const singleton = new CommandService();

export default singleton;
