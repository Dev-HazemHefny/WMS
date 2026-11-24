const path = require("node:path");
const { toolsDirectory, profile, prepareProfile } = require("./profile.cjs");

const { seedProfile } = require(path.join(toolsDirectory, "seed.cjs"));

prepareProfile(seedProfile).then(result => {
  console.log(result.existing ? `Demo profile already exists at ${profile}` : `Created demo profile at ${profile}`);
  console.log("Initial fixture counts", JSON.stringify(result.seedRows));
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
