var zip = require('bestzip');
const { version } = require('./public/manifest.json');
const { name } = require('./package.json');

const fileName = `${name}-v${version}.zip`;

zip({
  source: '*',
  destination: `../${fileName}`,
})
  .then(function () {
    console.log(`${fileName} built!`);
  })
  .catch(function (err) {
    console.error(err.stack);
    process.exit(1);
  });
