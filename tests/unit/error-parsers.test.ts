/**
 * Error Parser Unit Tests
 * Tests for all error parsers: TypeScript, Python, Rust, Go, ESLint, Generic
 */

import { describe, it, expect } from 'vitest';
import { TypeScriptErrorParser } from '../../src/subsystems/execution-sandbox/parsers/typescript.js';
import { PytestErrorParser } from '../../src/subsystems/execution-sandbox/parsers/python.js';
import { RustErrorParser } from '../../src/subsystems/execution-sandbox/parsers/rust.js';
import { GoErrorParser } from '../../src/subsystems/execution-sandbox/parsers/go.js';
import { ESLintErrorParser } from '../../src/subsystems/execution-sandbox/parsers/eslint.js';
import { GenericErrorParser } from '../../src/subsystems/execution-sandbox/parsers/generic.js';

describe('Error Parsers', () => {
  describe('TypeScriptErrorParser', () => {
    const parser = new TypeScriptErrorParser();

    it('should parse TypeScript compiler errors', () => {
      const output = `src/index.ts(10,23): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.
src/utils.ts(5,1): error TS2322: Type 'number' is not assignable to type 'string'.`;

      const errors = parser.parse(output);

      expect(errors).toHaveLength(2);
      expect(errors[0]).toMatchObject({
        type: 'type',
        severity: 'error',
        file: 'src/index.ts',
        line: 10,
        column: 23,
        code: 'TS2345',
        message: "Argument of type 'string' is not assignable to parameter of type 'number'."
      });
      expect(errors[1]).toMatchObject({
        file: 'src/utils.ts',
        line: 5,
        column: 1,
        code: 'TS2322'
      });
    });

    it('should parse TypeScript warnings', () => {
      const output = `src/app.ts(20,5): warning TS6133: 'unusedVar' is declared but its value is never read.`;

      const errors = parser.parse(output);

      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({
        type: 'lint',
        severity: 'warning',
        file: 'src/app.ts',
        line: 20,
        column: 5,
        code: 'TS6133'
      });
    });

    it('should return empty array for clean output', () => {
      const output = `tsc --noEmit
Build successful.`;

      const errors = parser.parse(output);
      expect(errors).toHaveLength(0);
    });

    it('should extract context from surrounding lines', () => {
      const output = `src/index.ts(5,10): error TS2304: Cannot find name 'undefinedVar'.
    3 | const x = 1;
    4 | const y = 2;
  > 5 | const z = undefinedVar;
    6 | console.log(z);`;

      const errors = parser.parse(output);

      expect(errors[0].context).toContain('undefinedVar');
    });
  });

  describe('PytestErrorParser', () => {
    const parser = new PytestErrorParser();

    it('should parse Python syntax errors', () => {
      const output = `  File "main.py", line 15
    if x > 5
            ^
SyntaxError: expected ':'

  File "utils.py", line 20
    def func()
             ^
SyntaxError: expected ':'`;

      const errors = parser.parse(output);

      expect(errors).toHaveLength(2);
      expect(errors[0]).toMatchObject({
        type: 'syntax',
        severity: 'error',
        file: 'main.py',
        line: 15,
        message: "expected ':'"
      });
      expect(errors[1]).toMatchObject({
        type: 'syntax',
        file: 'utils.py',
        line: 20
      });
    });

    it('should parse Python runtime errors', () => {
      const output = `Traceback (most recent call last):
  File "app.py", line 10, in <module>
    result = divide(10, 0)
  File "math_ops.py", line 5, in divide
    return a / b
ZeroDivisionError: division by zero`;

      const errors = parser.parse(output);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toMatchObject({
        type: 'runtime',
        severity: 'error',
        message: 'division by zero'
      });
    });

    it('should parse mypy type errors', () => {
      const output = `main.py:10: error: Argument 1 to "greet" has incompatible type "int"; expected "str"
main.py:15: error: Incompatible return value type (got "str", expected "int")`;

      const errors = parser.parse(output);

      expect(errors).toHaveLength(2);
      expect(errors[0]).toMatchObject({
        type: 'type',
        severity: 'error',
        file: 'main.py',
        line: 10
      });
    });

    it('should parse flake8/pylint warnings', () => {
      const output = `main.py:5:1: E302 expected 2 blank lines, found 1
main.py:10:5: W0613: Unused argument 'x' (unused-argument)`;

      const errors = parser.parse(output);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toMatchObject({
        type: 'lint',
        severity: 'warning'
      });
    });
  });

  describe('RustErrorParser', () => {
    const parser = new RustErrorParser();

    it('should parse rustc compilation errors', () => {
      const output = `error[E0425]: cannot find value 'x' in this scope
  --> src/main.rs:10:15
   |
10 |     let y = x + 5;
   |               ^ not found in this scope

error[E0308]: mismatched types
  --> src/lib.rs:25:20
   |
25 |     let s: String = 42;
   |                    ^^^ expected struct 'String', found integer`;

      const errors = parser.parse(output);

      expect(errors).toHaveLength(2);
      expect(errors[0]).toMatchObject({
        type: 'type',
        severity: 'error',
        file: 'src/main.rs',
        line: 10,
        column: 15,
        code: 'E0425',
        message: "cannot find value 'x' in this scope"
      });
      expect(errors[1]).toMatchObject({
        type: 'type',
        file: 'src/lib.rs',
        line: 25,
        code: 'E0308'
      });
    });

    it('should parse cargo test failures', () => {
      const output = `running 2 tests
test tests::test_add ... FAILED
test tests::test_sub ... ok

failures:

---- tests::test_add stdout ----
thread 'tests::test_add' panicked at src/lib.rs:45:5:
assertion failed: add(2, 2) == 5

failures:
    tests::test_add

test result: FAILED. 1 passed; 1 failed; 0 ignored`;

      const errors = parser.parse(output);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toMatchObject({
        type: 'test',
        severity: 'error'
      });
    });

    it('should parse clippy warnings', () => {
      const output = `warning: useless use of 'format!'
  --> src/main.rs:15:9
   |
15 |         format!("hello")
   |         ^^^^^^^^^^^^^^^^
   = note: consider using 'to_string()' instead`;

      const errors = parser.parse(output);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toMatchObject({
        type: 'lint',
        severity: 'warning',
        file: 'src/main.rs',
        line: 15
      });
    });

    it('should return empty array for successful build', () => {
      const output = `Compiling myapp v0.1.0
    Finished dev [unoptimized + debuginfo] target(s) in 1.23s`;

      const errors = parser.parse(output);
      expect(errors).toHaveLength(0);
    });
  });

  describe('GoErrorParser', () => {
    const parser = new GoErrorParser();

    it('should parse Go compilation errors', () => {
      const output = `./main.go:15:9: undefined: someFunction
./main.go:20:5: cannot use "string" (type string) as type int in assignment
./utils.go:8:1: syntax error: unexpected newline, expecting comma or )`;

      const errors = parser.parse(output);

      expect(errors).toHaveLength(3);
      expect(errors[0]).toMatchObject({
        type: 'type',
        severity: 'error',
        file: './main.go',
        line: 15,
        column: 9,
        message: 'undefined: someFunction'
      });
      expect(errors[1]).toMatchObject({
        file: './main.go',
        line: 20
      });
      expect(errors[2]).toMatchObject({
        type: 'syntax',
        file: './utils.go',
        line: 8
      });
    });

    it('should parse go test output', () => {
      const output = `--- FAIL: TestAdd (0.00s)
    calc_test.go:10: Expected 5, got 4
--- PASS: TestSub (0.00s)
FAIL
exit status 1
FAIL	github.com/example/calc	0.123s`;

      const errors = parser.parse(output);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toMatchObject({
        type: 'test',
        severity: 'error',
        file: 'calc_test.go',
        line: 10,
        message: 'Expected 5, got 4'
      });
    });

    it('should parse golint warnings', () => {
      const output = `main.go:10:6: exported function DoSomething should have comment or be unexported
main.go:25:2: don't use underscores in Go names; var my_var should be myVar`;

      const errors = parser.parse(output);

      expect(errors).toHaveLength(2);
      expect(errors[0]).toMatchObject({
        type: 'lint',
        severity: 'warning',
        file: 'main.go',
        line: 10
      });
    });
  });

  describe('ESLintErrorParser', () => {
    const parser = new ESLintErrorParser();

    it('should parse ESLint errors', () => {
      const output = `/home/project/src/index.js
  10:5  error  'unusedVar' is assigned a value but never used  no-unused-vars
  15:3  error  Expected ';' but got '}'                      semi

/home/project/src/utils.js
  5:1  error  Unexpected console statement                   no-console`;

      const errors = parser.parse(output);

      expect(errors).toHaveLength(3);
      expect(errors[0]).toMatchObject({
        type: 'lint',
        severity: 'error',
        file: '/home/project/src/index.js',
        line: 10,
        column: 5,
        code: 'no-unused-vars',
        message: "'unusedVar' is assigned a value but never used"
      });
    });

    it('should parse ESLint warnings', () => {
      const output = `src/app.tsx
  20:10  warning  'any' type is not recommended  @typescript-eslint/no-explicit-any
  25:3   warning  Missing return type on function  @typescript-eslint/explicit-function-return-type`;

      const errors = parser.parse(output);

      expect(errors).toHaveLength(2);
      expect(errors[0]).toMatchObject({
        severity: 'warning',
        code: '@typescript-eslint/no-explicit-any'
      });
    });

    it('should parse compact eslint output format', () => {
      const output = `src/index.js: line 10, col 5, Error - 'x' is not defined. (no-undef)
src/index.js: line 15, col 3, Warning - Missing semicolon. (semi)`;

      const errors = parser.parse(output);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toMatchObject({
        severity: 'error',
        line: 10,
        code: 'no-undef'
      });
    });
  });

  describe('GenericErrorParser', () => {
    const parser = new GenericErrorParser();

    it('should parse generic error patterns', () => {
      const output = `Error: Something went wrong
  at /path/to/file.js:10:5
  at Function.execute (/path/to/other.js:25:10)

Warning: Deprecated API usage
  at /path/to/file.js:30:3`;

      const errors = parser.parse(output);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toMatchObject({
        severity: 'error',
        message: 'Something went wrong'
      });
    });

    it('should extract file and line from stack traces', () => {
      const output = `Error: File not found
    at Object.readFile (fs.js:10:15)
    at processFile (/app/src/utils.js:25:20)`;

      const errors = parser.parse(output);

      expect(errors.length).toBeGreaterThan(0);
    });

    it('should handle various error formats', () => {
      const formats = [
        'ERROR: Failed to connect to database',
        '[ERROR] Connection timeout',
        'error: Unexpected token',
        'FATAL: Out of memory'
      ];

      for (const output of formats) {
        const errors = parser.parse(output);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0].severity).toBe('error');
      }
    });

    it('should handle warning patterns', () => {
      const output = `WARNING: Configuration deprecated
WARN: This will be removed in future versions
[WARNING] Low disk space`;

      const errors = parser.parse(output);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors.every(e => e.severity === 'warning')).toBe(true);
    });

    it('should return empty array for clean output', () => {
      const output = `Build completed successfully.
All checks passed.`;

      const errors = parser.parse(output);
      expect(errors).toHaveLength(0);
    });
  });

  describe('Parser Integration', () => {
    it('should handle multi-line error messages', () => {
      const parser = new TypeScriptErrorParser();
      const output = `src/complex.ts(10,5): error TS1234: This is a complex error
    that spans multiple lines
    with additional context
src/complex.ts(20,10): error TS5678: Another error`;

      const errors = parser.parse(output);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should handle paths with spaces', () => {
      const parser = new GenericErrorParser();
      const output = `Error in /path with spaces/file.js: line 10`;

      const errors = parser.parse(output);
      // Should not crash
      expect(Array.isArray(errors)).toBe(true);
    });

    it('should handle very long error messages', () => {
      const parser = new PythonErrorParser();
      const longMessage = 'A'.repeat(1000);
      const output = `  File "test.py", line 1\n    ${longMessage}\n         ^\nSyntaxError: invalid syntax`;

      const errors = parser.parse(output);
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});
