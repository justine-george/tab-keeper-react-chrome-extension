const fs = require('fs');

function readJsonFile(filename) {
  const rawData = fs.readFileSync(filename, 'utf-8');
  return JSON.parse(rawData);
}

function writeJsonFile(filename, data) {
  const stringifiedData = JSON.stringify(data, null, 2); // with 2 spaces indentation
  fs.writeFileSync(filename, stringifiedData, 'utf-8');
}

// Read package.json to get the version
const packageData = readJsonFile('package.json');
const packageVersion = packageData.version;

// Read manifest.json
const manifestData = readJsonFile('public/manifest.json');

// Update the version in manifest.json if it's different
if (manifestData.version !== packageVersion) {
  manifestData.version = packageVersion;
  writeJsonFile('public/manifest.json', manifestData);
  console.log(`Updated manifest.json to version: ${packageVersion}`);
} else {
  console.log('Versions are already in sync!');
}
