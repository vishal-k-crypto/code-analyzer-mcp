/**
 * Custom Error Classes
 * Provides specific error types for different failure modes
 */

export class GovernanceError extends Error {
  public readonly code = 'GOVERNANCE_VIOLATION';
  public readonly forbiddenFiles: string[];
  public readonly attemptedFiles: string[];

  constructor(forbiddenFiles: string[], attemptedFiles: string[]) {
    const message = `Governance Error: Attempted to modify forbidden files.\n` +
      `Forbidden: ${forbiddenFiles.join(', ')}\n` +
      `This action has been blocked. Please respect the bounded context.`;
    super(message);
    this.name = 'GovernanceError';
    this.forbiddenFiles = forbiddenFiles;
    this.attemptedFiles = attemptedFiles;
    
    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, GovernanceError.prototype);
  }
}

export class ValidationError extends Error {
  public readonly code = 'VALIDATION_ERROR';
  
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class StateError extends Error {
  public readonly code = 'STATE_ERROR';
  
  constructor(message: string) {
    super(message);
    this.name = 'StateError';
    Object.setPrototypeOf(this, StateError.prototype);
  }
}
