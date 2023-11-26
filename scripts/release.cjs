const { execSync } = require('child_process');

function runCommand(command) {
  try {
    execSync(command, { stdio: 'inherit' });
  } catch (error) {
    console.error(`Failed to execute ${command}`, error);
    process.exit(1);
  }
}

function hasChanges() {
  try {
    // Check for unstaged changes
    execSync('git diff --exit-code');
    // Check for uncommitted changes in the staging area
    execSync('git diff --cached --exit-code');
    return false;
  } catch (error) {
    return true;
  }
}

function release(type) {
  runCommand(`npm run test`);
  runCommand(`npm run build`);
  runCommand(`npm version ${type} --no-git-tag-version`);
  runCommand(`npm run sync-versions`);
  runCommand(`npm run pretty-build`);
  runCommand(`git add -A`);

  if (hasChanges()) {
    runCommand(
      `git commit -m "Bump version to ${require('../package.json').version}"`
    );
  } else {
    console.log('No changes to commit');
  }

  runCommand(`npm run create-tag-and-push`);
}

const args = process.argv.slice(2);
const releaseType = args[0];

if (!['patch', 'minor', 'major'].includes(releaseType)) {
  console.error('Invalid release type. Use "patch", "minor", or "major".');
  process.exit(1);
}

release(releaseType);
