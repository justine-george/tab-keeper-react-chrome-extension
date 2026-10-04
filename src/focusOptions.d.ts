// FocusOptions.focusVisible: Chrome and Firefox honour it; TypeScript's DOM lib
// does not declare it yet.
interface FocusOptions {
  focusVisible?: boolean;
}
