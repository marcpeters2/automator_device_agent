import {OutletState} from "../constants";

export type HardwareCommands = {
    // Keys are pin numbers
    [key: number]: OutletCommand[]
};

export type OutletCommand = {
    time: string,
    state: OutletState,
    isLast?: boolean
}
