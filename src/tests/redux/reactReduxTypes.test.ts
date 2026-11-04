import { useDispatch } from 'react-redux';
import { expectTypeOf, test } from 'vitest';

// KAN-920. With no top-level redux these types turn to any, and skipLibCheck keeps tsc quiet. tsc is the check.
test('react-redux finds the redux types', () => {
  expectTypeOf<ReturnType<typeof useDispatch>>().not.toBeAny();
});
