/**
 * Language Detector
 * Detects project type and appropriate Docker images
 */

import { promises as fs } from 'fs';
import { join } from 'path';

/** Default Docker images for different project types */
export const DEFAULT_IMAGES: Record<string, string> = {
  node: 'node:20-alpine',
  python: 'python:3.11-alpine',
  rust: 'rust:latest',
  go: 'golang:1.22-alpine',
  java: 'maven:3.9-eclipse-temurin-21-alpine',
  default: 'node:20-alpine'
};

export type ProjectType = 'node' | 'python' | 'rust' | 'go' | 'java' | 'unknown';

/**
 * Detect project type based on files in directory
 */
export async function detectProjectType(projectPath: string): Promise<ProjectType> {
  try {
    const files = await fs.readdir(projectPath);

    if (files.includes('package.json')) {
      return 'node';
    }
    if (files.includes('Cargo.toml')) {
      return 'rust';
    }
    if (files.includes('go.mod')) {
      return 'go';
    }
    if (files.includes('pom.xml') || files.includes('build.gradle')) {
      return 'java';
    }
    if (files.includes('pyproject.toml') || files.includes('requirements.txt') || files.includes('setup.py')) {
      return 'python';
    }

    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Get Docker image for project type
 */
export function getDockerImage(projectType: ProjectType): string {
  return DEFAULT_IMAGES[projectType] || DEFAULT_IMAGES.default;
}

/**
 * Detect the appropriate Docker image based on project files
 */
export async function detectDockerImage(projectPath: string): Promise<string> {
  const projectType = await detectProjectType(projectPath);
  return getDockerImage(projectType);
}

/**
 * Detect verification commands for project type
 */
export async function detectVerificationCommands(
  projectPath: string,
  testFilter?: string[]
): Promise<string[]> {
  const projectType = await detectProjectType(projectPath);

  switch (projectType) {
    case 'node':
      return detectNodeCommands(projectPath, testFilter);
    case 'python':
      return detectPythonCommands(projectPath, testFilter);
    case 'rust':
      return detectRustCommands(projectPath, testFilter);
    case 'go':
      return detectGoCommands(projectPath, testFilter);
    case 'java':
      return detectJavaCommands(projectPath, testFilter);
    default:
      return [];
  }
}

/**
 * Detect Node.js verification commands
 */
async function detectNodeCommands(
  projectPath: string,
  testFilter?: string[]
): Promise<string[]> {
  const packageJsonPath = join(projectPath, 'package.json');
  
  try {
    const content = await fs.readFile(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(content);
    const commands: string[] = [];

    // TypeScript check
    try {
      await fs.access(join(projectPath, 'tsconfig.json'));
      commands.push('npx tsc --noEmit');
    } catch {
      // No tsconfig
    }

    // Scripts from package.json
    if (packageJson.scripts) {
      if (packageJson.scripts.build) {
        commands.push('npm run build');
      }
      if (packageJson.scripts.test) {
        if (testFilter && testFilter.length > 0) {
          commands.push(`npm test -- --findRelatedTests ${testFilter.join(' ')}`);
        } else {
          commands.push('npm test');
        }
      }
      if (packageJson.scripts.lint) {
        commands.push('npm run lint');
      }
    }

    if (commands.length > 0) {
      return commands;
    }

    return testFilter && testFilter.length > 0
      ? [`npm test -- --findRelatedTests ${testFilter.join(' ')}`]
      : ['npm install', 'npm test'];
  } catch {
    return ['npm install', 'npm test'];
  }
}

/**
 * Detect Python verification commands
 */
async function detectPythonCommands(
  projectPath: string,
  testFilter?: string[]
): Promise<string[]> {
  const commands: string[] = [];
  
  const hasPyproject = await fileExists(join(projectPath, 'pyproject.toml'));
  const hasRequirements = await fileExists(join(projectPath, 'requirements.txt'));

  if (hasPyproject || hasRequirements) {
    if (testFilter && testFilter.length > 0) {
      commands.push(`python -m pytest ${testFilter.join(' ')}`);
    } else {
      commands.push('python -m pytest');
    }
  }

  return commands;
}

/**
 * Detect Rust verification commands
 */
async function detectRustCommands(
  _projectPath: string,
  _testFilter?: string[]
): Promise<string[]> {
  // Rust test filtering is complex, typically uses module names
  return ['cargo build', 'cargo test'];
}

/**
 * Detect Go verification commands
 */
async function detectGoCommands(
  _projectPath: string,
  testFilter?: string[]
): Promise<string[]> {
  if (testFilter && testFilter.length > 0) {
    const testDirs = new Set<string>();
    for (const testPath of testFilter) {
      const dir = testPath.substring(0, testPath.lastIndexOf('/'));
      if (dir) testDirs.add(dir);
    }
    const dirPaths = Array.from(testDirs).join(' ');
    return ['go build ./...', `go test ${dirPaths} -v`];
  }
  return ['go build ./...', 'go test ./...'];
}

/**
 * Detect Java verification commands
 */
async function detectJavaCommands(
  _projectPath: string,
  _testFilter?: string[]
): Promise<string[]> {
  return ['mvn compile', 'mvn test'];
}

/**
 * Check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if command is a test command
 */
export function isTestCommand(cmd: string): boolean {
  const testPatterns = [
    'test', 'jest', 'vitest', 'mocha', 
    'pytest', 'cargo test', 'go test',
    'mvn test', 'gradle test'
  ];
  return testPatterns.some(pattern => 
    cmd.toLowerCase().includes(pattern.toLowerCase())
  );
}

/**
 * Build filtered test command based on test runner
 */
export function buildFilteredTestCommand(
  baseScript: string,
  testFilter: string[],
  projectType: ProjectType
): string {
  if (projectType === 'node') {
    if (baseScript.includes('jest') || baseScript.includes('vitest')) {
      return `npm test -- --findRelatedTests ${testFilter.join(' ')}`;
    }
    return `npm test -- ${testFilter.join(' ')}`;
  }

  if (projectType === 'python') {
    return `python -m pytest ${testFilter.join(' ')}`;
  }

  if (projectType === 'go') {
    return `go test ${testFilter.join(' ')}`;
  }

  return baseScript;
}
