/**
 * Execution Sandbox Subsystem
 * Main entry point for command execution and verification
 * 
 * All commands are executed inside Docker containers for security isolation,
 * preventing malicious code from compromising the host machine.
 */

export { ExecutionSandbox, DockerConfig, DEFAULT_IMAGES } from './runner.js';
