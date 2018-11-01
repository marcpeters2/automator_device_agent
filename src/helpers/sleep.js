const Promise = require("bluebird");

function sleep(ms) {
  return Promise.delay(ms);
}

module.exports = sleep;
