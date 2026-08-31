const {
  AndroidConfig,
  withAndroidManifest,
} = require("expo/config-plugins");

module.exports = function withPrivateNetworkHttp(config) {
  return withAndroidManifest(config, (androidConfig) => {
    const application =
      AndroidConfig.Manifest.getMainApplicationOrThrow(
        androidConfig.modResults,
      );

    // URL validation limits cleartext use to loopback and private LAN hosts.
    application.$["android:usesCleartextTraffic"] = "true";
    return androidConfig;
  });
};
