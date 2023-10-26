import * as core from "@actions/core";

export class ActionError extends Error {
  critical: boolean;
  constructor(errorMessage: string, critical: boolean = false) {
    super(errorMessage);
    this.name = this.constructor.name;
    this.critical = critical;
  }
}

// This function is easier to spy on in tests than the class constructor directly.
/**
 * Generate an error message with optional directive to stop execution
 * @param {string} message Error message to report to logs
 * @param {boolean} critical - if true will halt execution of the action
 * @returns {ActionError}
 */
export const err = (message: string, critical: boolean = false) =>
  new ActionError(message, critical);

export const handleError = (error: ActionError): void => {
  core.error(error.message);
  if (error.critical) {
    core.setFailed(error.message);
  }
};
