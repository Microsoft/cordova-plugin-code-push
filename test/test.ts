/// <reference path="../typings/assert.d.ts" />
/// <reference path="../typings/codePush.d.ts" />
/// <reference path="../node_modules/code-push-plugin-testing-framework/typings/code-push-plugin-testing-framework.d.ts" />
/// <reference path="../typings/mocha.d.ts" />
/// <reference path="../typings/mkdirp.d.ts" />
/// <reference path="../typings/node.d.ts" />
/// <reference path="../typings/q.d.ts" />

"use strict";

import assert = require("assert");
import fs = require("fs");
import mkdirp = require("mkdirp");
import path = require("path");

import { Platform, PluginTestingFramework, ProjectManager, setupTestRunScenario, setupUpdateScenario, ServerUtil, TestBuilder, TestConfig, TestUtil } from "code-push-plugin-testing-framework";

import Q = require("q");

var del = require("del");

//////////////////////////////////////////////////////////////////////////////////////////
// Create the platforms to run the tests on.

interface CordovaPlatform {
    /**
     * Returns the name of the platform used in Cordova CLI methods.
     */
    getCordovaName(): string;
    
    /**
     * Called when the platform is prepared.
     */
    onPreparePlatform(projectManager: CordovaProjectManager, projectDirectory: string): Q.Promise<void>;
    
    /**
     * Called when the platform is cleaned up.
     */
    onCleanupPlatform(projectManager: CordovaProjectManager, projectDirectory: string): Q.Promise<void>;
    
    /**
     * Returns the path to this platform's www folder
     */
    getPlatformWwwPath(projectDirectory: string): string;
}

/**
 * Platform used for running tests on Android
 */
class CordovaAndroid extends Platform.Android implements CordovaPlatform {
    constructor() {
        super(new Platform.AndroidEmulatorManager());
    }
    
    /**
     * Returns the name of the platform used in Cordova CLI methods.
     */
    getCordovaName(): string {
        return "android";
    }
    
    /**
     * Called when the platform is prepared.
     */
    onPreparePlatform(projectManager: CordovaProjectManager, projectDirectory: string): Q.Promise<void> {
        // Noop
        return Q<void>(null);
    }
    
    /**
     * Called when the platform is cleaned up.
     */
    onCleanupPlatform(projectManager: CordovaProjectManager, projectDirectory: string): Q.Promise<void> {
        // Noop
        return Q<void>(null);
    }
    
    /**
     * Returns the path to this platform's www folder
     */
    getPlatformWwwPath(projectDirectory: string): string {
        return path.join(projectDirectory, "platforms/android/assets/www");
    }
}

/**
 * Platform used for running tests on iOS using the UIWebView
 */
class CordovaIOSUI extends Platform.IOS implements CordovaPlatform {
    constructor() {
        super(new Platform.IOSEmulatorManager());
    }

    /**
     * Gets the platform name. (e.g. "android" for the Android platform).
     */
    public getName(): string {
        return "ios (uiwebview)";
    }
    
    /**
     * Returns the name of the platform used in Cordova CLI methods.
     */
    getCordovaName(): string {
        return "ios";
    }
    
    /**
     * Called when the platform is prepared.
     */
    onPreparePlatform(projectManager: CordovaProjectManager, projectDirectory: string): Q.Promise<void> {
        // Noop
        return Q<void>(null);
    }
    
    /**
     * Called when the platform is cleaned up.
     */
    onCleanupPlatform(projectManager: CordovaProjectManager, projectDirectory: string): Q.Promise<void> {
        // Noop
        return Q<void>(null);
    }
    
    /**
     * Returns the path to this platform's www folder
     */
    getPlatformWwwPath(projectDirectory: string): string {
        return path.join(projectDirectory, "platforms/ios/www");
    }
}

/**
 * Platform used for running tests on iOS using the WkWebView
 */
class CordovaIOSWK extends CordovaIOSUI {
    public static WkWebViewEnginePluginName = "cordova-plugin-wkwebview-engine";
    
    constructor() {
        super();
    }

    /**
     * Gets the platform name. (e.g. "android" for the Android platform).
     */
    public getName(): string {
        return "ios (wkwebview)";
    }
    
    /**
     * The command line flag used to determine whether or not this platform should run.
     * Runs when the flag is present, doesn't run otherwise.
     */
    getCommandLineFlagName(): string {
        return "--ios-wk";
    }
    
    /**
     * Called when the platform is prepared.
     */
    onPreparePlatform(projectManager: CordovaProjectManager, projectDirectory: string): Q.Promise<void> {
        return projectManager.addCordovaPlugin(projectDirectory, CordovaIOSWK.WkWebViewEnginePluginName);
    }
    
    /**
     * Called when the platform is cleaned up.
     */
    onCleanupPlatform(projectManager: CordovaProjectManager, projectDirectory: string): Q.Promise<void> {
        return projectManager.removeCordovaPlugin(projectDirectory, CordovaIOSWK.WkWebViewEnginePluginName);
    }
}

var supportedPlatforms: Platform.IPlatform[] = [new CordovaAndroid(), new CordovaIOSUI(), new CordovaIOSWK()];

//////////////////////////////////////////////////////////////////////////////////////////
// Create the ProjectManager to use for the tests.

class CordovaProjectManager extends ProjectManager {
    public static AcquisitionSDKPluginName = "code-push";
    
    /**
     * Returns the name of the plugin being tested, ie Cordova or React-Native
     */
    public getPluginName(): string {
        return "Cordova";
    }

    /**
     * Creates a new test application at the specified path, and configures it
     * with the given server URL, android and ios deployment keys.
     */
    public setupProject(projectDirectory: string, templatePath: string, appName: string, appNamespace: string, version?: string): Q.Promise<void> {
        if (fs.existsSync(projectDirectory)) {
            del.sync([projectDirectory], { force: true });
        }
        mkdirp.sync(projectDirectory);
        
        var indexHtml = "www/index.html";
        var destinationIndexPath = path.join(projectDirectory, indexHtml);

        return TestUtil.getProcessOutput("cordova create " + projectDirectory + " " + appNamespace + " " + appName + " --copy-from " + templatePath)
            .then<string>(TestUtil.replaceString.bind(undefined, destinationIndexPath, TestUtil.CODE_PUSH_APP_VERSION_PLACEHOLDER, version))
            .then<string>(this.addCordovaPlugin.bind(this, projectDirectory, CordovaProjectManager.AcquisitionSDKPluginName))
            .then<void>(this.addCordovaPlugin.bind(this, projectDirectory, TestConfig.thisPluginPath));
    }
    
    /**
     * Sets up the scenario for a test in an already existing project.
     */
    public setupScenario(projectDirectory: string, appId: string, templatePath: string, jsPath: string, targetPlatform: Platform.IPlatform, version?: string): Q.Promise<void> {
        var indexHtml = "www/index.html";
        var templateIndexPath = path.join(templatePath, indexHtml);
        var destinationIndexPath = path.join(projectDirectory, indexHtml);
        
        var scenarioJs = "www/" + jsPath;
        var templateScenarioJsPath = path.join(templatePath, scenarioJs);
        var destinationScenarioJsPath = path.join(projectDirectory, scenarioJs);
        
        var configXml = "config.xml";
        var templateConfigXmlPath = path.join(templatePath, configXml);
        var destinationConfigXmlPath = path.join(projectDirectory, configXml);
        
        var packageFile = eval("(" + fs.readFileSync("./package.json", "utf8") + ")");
        var pluginVersion = packageFile.version;
        
        console.log("Setting up scenario " + jsPath + " in " + projectDirectory);

        // copy index html file and replace
        return TestUtil.copyFile(templateIndexPath, destinationIndexPath, true)
            .then(TestUtil.replaceString.bind(undefined, destinationIndexPath, TestUtil.SERVER_URL_PLACEHOLDER, targetPlatform.getServerUrl()))
            .then(TestUtil.replaceString.bind(undefined, destinationIndexPath, TestUtil.INDEX_JS_PLACEHOLDER, jsPath))
            .then(TestUtil.replaceString.bind(undefined, destinationIndexPath, TestUtil.CODE_PUSH_APP_VERSION_PLACEHOLDER, version))
            // copy scenario js file and replace
            .then(() => {
                return TestUtil.copyFile(templateScenarioJsPath, destinationScenarioJsPath, true);
            })
            .then(TestUtil.replaceString.bind(undefined, destinationScenarioJsPath, TestUtil.SERVER_URL_PLACEHOLDER, targetPlatform.getServerUrl()))
            // copy config xml file and replace
            .then(() => {
                return TestUtil.copyFile(templateConfigXmlPath, destinationConfigXmlPath, true);
            })
            .then(TestUtil.replaceString.bind(undefined, destinationConfigXmlPath, TestUtil.ANDROID_KEY_PLACEHOLDER, targetPlatform.getDefaultDeploymentKey()))
            .then(TestUtil.replaceString.bind(undefined, destinationConfigXmlPath, TestUtil.IOS_KEY_PLACEHOLDER, targetPlatform.getDefaultDeploymentKey()))
            .then(TestUtil.replaceString.bind(undefined, destinationConfigXmlPath, TestUtil.SERVER_URL_PLACEHOLDER, targetPlatform.getServerUrl()))
            .then(TestUtil.replaceString.bind(undefined, destinationConfigXmlPath, TestUtil.PLUGIN_VERSION_PLACEHOLDER, pluginVersion))
            .then<void>(this.prepareCordovaPlatform.bind(this, projectDirectory, targetPlatform));
    }

    /**
     * Creates a CodePush update package zip for a project.
     */
    public createUpdateArchive(projectDirectory: string, targetPlatform: Platform.IPlatform, isDiff?: boolean): Q.Promise<string> {
        return TestUtil.archiveFolder((<CordovaPlatform><any>targetPlatform).getPlatformWwwPath(projectDirectory), "www", path.join(projectDirectory, "update.zip"), isDiff);
    }
    
    /**
     * Prepares a specific platform for tests.
     */
    public preparePlatform(projectDirectory: string, targetPlatform: Platform.IPlatform): Q.Promise<void> {
        return this.addCordovaPlatform(projectDirectory, targetPlatform)
            .catch<void>(() => { /* If the platform is already added, there's no issue, so ignore. */ return undefined; })
            .then<void>(() => {
                return (<CordovaPlatform><any>targetPlatform).onPreparePlatform(this, projectDirectory);
            });
    }
    
    /**
     * Cleans up a specific platform after tests.
     */
    public cleanupAfterPlatform(projectDirectory: string, targetPlatform: Platform.IPlatform): Q.Promise<void> {
        return this.removeCordovaPlatform(projectDirectory, targetPlatform)
            .then<void>(() => {
                return (<CordovaPlatform><any>targetPlatform).onCleanupPlatform(this, projectDirectory);
            });
    }

    /**
     * Runs the test app on the given target / platform.
     */
    public runApplication(projectDirectory: string, targetPlatform: Platform.IPlatform): Q.Promise<void> {
        console.log("Running project in " + projectDirectory + " on " + targetPlatform.getName());
        // Don't log the build output because iOS's build output is too verbose and overflows the buffer!
        return TestUtil.getProcessOutput("cordova run " + (<CordovaPlatform><any>targetPlatform).getCordovaName(), { cwd: projectDirectory, noLogStdOut: true }).then(() => { return null; });
    }

    /**
     * Prepares the Cordova project for the test app on the given target / platform.
     */
    public prepareCordovaPlatform(projectDirectory: string, targetPlatform: Platform.IPlatform): Q.Promise<void> {
        console.log("Preparing project in " + projectDirectory + " for " + targetPlatform.getName());
        return TestUtil.getProcessOutput("cordova prepare " + (<CordovaPlatform><any>targetPlatform).getCordovaName(), { cwd: projectDirectory }).then(() => { return null; });
    }

    /**
     * Adds a platform to a Cordova project. 
     */
    public addCordovaPlatform(projectDirectory: string, targetPlatform: Platform.IPlatform, version?: string): Q.Promise<void> {
        console.log("Adding " + targetPlatform.getName() + " to project in " + projectDirectory);
        return TestUtil.getProcessOutput("cordova platform add " + (<CordovaPlatform><any>targetPlatform).getCordovaName() + (version ? "@" + version : ""), { cwd: projectDirectory }).then(() => { return null; });
    }

    /**
     * Adds a platform to a Cordova project. 
     */
    public removeCordovaPlatform(projectDirectory: string, targetPlatform: Platform.IPlatform, version?: string): Q.Promise<void> {
        console.log("Removing " + targetPlatform.getName() + " to project in " + projectDirectory);
        return TestUtil.getProcessOutput("cordova platform remove " + (<CordovaPlatform><any>targetPlatform).getCordovaName() + (version ? "@" + version : ""), { cwd: projectDirectory }).then(() => { return null; });
    }
    
    /**
     * Adds a plugin to a Cordova project.
     */
    public addCordovaPlugin(projectDirectory: string, plugin: string): Q.Promise<void> {
        console.log("Adding plugin " + plugin + " to " + projectDirectory);
        return TestUtil.getProcessOutput("cordova plugin add " + plugin, { cwd: projectDirectory }).then(() => { return null; });
    }  
    
    /**
     * Removes a plugin from a Cordova project.
     */
    public removeCordovaPlugin(projectDirectory: string, plugin: string): Q.Promise<void> {
        console.log("Removing plugin " + plugin + " from " + projectDirectory);
        return TestUtil.getProcessOutput("cordova plugin remove " + plugin, { cwd: projectDirectory }).then(() => { return null; });
    }
};

//////////////////////////////////////////////////////////////////////////////////////////
// Scenarios used in the tests.

const ScenarioCheckForUpdatePath = "js/scenarioCheckForUpdate.js";
const ScenarioCheckForUpdateCustomKey = "js/scenarioCheckForUpdateCustomKey.js";
const ScenarioDownloadUpdate = "js/scenarioDownloadUpdate.js";
const ScenarioInstall = "js/scenarioInstall.js";
const ScenarioInstallOnResumeWithRevert = "js/scenarioInstallOnResumeWithRevert.js";
const ScenarioInstallOnRestartWithRevert = "js/scenarioInstallOnRestartWithRevert.js";
const ScenarioInstallOnRestart2xWithRevert = "js/scenarioInstallOnRestart2xWithRevert.js";
const ScenarioInstallWithRevert = "js/scenarioInstallWithRevert.js";
const ScenarioSync1x = "js/scenarioSync.js";
const ScenarioSyncResume = "js/scenarioSyncResume.js";
const ScenarioSyncResumeDelay = "js/scenarioSyncResumeDelay.js";
const ScenarioSyncRestartDelay = "js/scenarioSyncResumeDelay.js";
const ScenarioSync2x = "js/scenarioSync2x.js";
const ScenarioRestart = "js/scenarioRestart.js";
const ScenarioSyncMandatoryDefault = "js/scenarioSyncMandatoryDefault.js";
const ScenarioSyncMandatoryResume = "js/scenarioSyncMandatoryResume.js";
const ScenarioSyncMandatoryRestart = "js/scenarioSyncMandatoryRestart.js";

const UpdateDeviceReady = "js/updateDeviceReady.js";
const UpdateNotifyApplicationReady = "js/updateNotifyApplicationReady.js";
const UpdateSync = "js/updateSync.js";
const UpdateSync2x = "js/updateSync2x.js";
const UpdateNotifyApplicationReadyConditional = "js/updateNARConditional.js";

//////////////////////////////////////////////////////////////////////////////////////////
// Initialize the tests.

PluginTestingFramework.initializeTests(new CordovaProjectManager(), supportedPlatforms, 
    (projectManager: ProjectManager, targetPlatform: Platform.IPlatform) => {
        TestBuilder.describe("#window.codePush.checkForUpdate",
            () => {
                TestBuilder.it("window.codePush.checkForUpdate.noUpdate", false,
                    (done: MochaDone) => {
                        var noUpdateResponse = ServerUtil.createDefaultResponse();
                        noUpdateResponse.isAvailable = false;
                        noUpdateResponse.appVersion = "0.0.1";
                        ServerUtil.updateResponse = { updateInfo: noUpdateResponse };

                        ServerUtil.testMessageCallback = (requestBody: any) => {
                            try {
                                assert.equal(ServerUtil.TestMessage.CHECK_UP_TO_DATE, requestBody.message);
                                done();
                            } catch (e) {
                                done(e);
                            }
                        };

                        projectManager.runApplication(TestConfig.testRunDirectory, targetPlatform);
                    });
                
                TestBuilder.it("window.codePush.checkForUpdate.sendsBinaryHash", false,
                    (done: MochaDone) => {
                        var noUpdateResponse = ServerUtil.createDefaultResponse();
                        noUpdateResponse.isAvailable = false;
                        noUpdateResponse.appVersion = "0.0.1";

                        ServerUtil.updateCheckCallback = (request: any) => {
                            try {
                                assert(request.query.packageHash);
                            } catch (e) {
                                done(e);
                            }
                        };
                        
                        ServerUtil.updateResponse = { updateInfo: noUpdateResponse };

                        ServerUtil.testMessageCallback = (requestBody: any) => {
                            try {
                                assert.equal(ServerUtil.TestMessage.CHECK_UP_TO_DATE, requestBody.message);
                                done();
                            } catch (e) {
                                done(e);
                            }
                        };

                        projectManager.runApplication(TestConfig.testRunDirectory, targetPlatform);
                    });
                
                TestBuilder.it("window.codePush.checkForUpdate.noUpdate.updateAppVersion", false,
                    (done: MochaDone) => {
                        var updateAppVersionResponse = ServerUtil.createDefaultResponse();
                        updateAppVersionResponse.updateAppVersion = true;
                        updateAppVersionResponse.appVersion = "2.0.0";

                        ServerUtil.updateResponse = { updateInfo: updateAppVersionResponse };

                        ServerUtil.testMessageCallback = (requestBody: any) => {
                            try {
                                assert.equal(ServerUtil.TestMessage.CHECK_UP_TO_DATE, requestBody.message);
                                done();
                            } catch (e) {
                                done(e);
                            }
                        };

                        projectManager.runApplication(TestConfig.testRunDirectory, targetPlatform);
                    });
                
                TestBuilder.it("window.codePush.checkForUpdate.update", true,
                    (done: MochaDone) => {
                        var updateResponse = ServerUtil.createUpdateResponse();
                        ServerUtil.updateResponse = { updateInfo: updateResponse };

                        ServerUtil.testMessageCallback = (requestBody: any) => {
                            try {
                                assert.equal(ServerUtil.TestMessage.CHECK_UPDATE_AVAILABLE, requestBody.message);
                                assert.notEqual(null, requestBody.args[0]);
                                var remotePackage: IRemotePackage = requestBody.args[0];
                                assert.equal(remotePackage.downloadUrl, updateResponse.downloadURL);
                                assert.equal(remotePackage.isMandatory, updateResponse.isMandatory);
                                assert.equal(remotePackage.label, updateResponse.label);
                                assert.equal(remotePackage.packageHash, updateResponse.packageHash);
                                assert.equal(remotePackage.packageSize, updateResponse.packageSize);
                                assert.equal(remotePackage.deploymentKey, targetPlatform.getDefaultDeploymentKey());
                                done();
                            } catch (e) {
                                done(e);
                            }
                        };

                        ServerUtil.updateCheckCallback = (request: any) => {
                            try {
                                assert.notEqual(null, request);
                                assert.equal(request.query.deploymentKey, targetPlatform.getDefaultDeploymentKey());
                            } catch (e) {
                                done(e);
                            }
                        };

                        projectManager.runApplication(TestConfig.testRunDirectory, targetPlatform);
                    });
                
                TestBuilder.it("window.codePush.checkForUpdate.error", false,
                    (done: MochaDone) => {
                        ServerUtil.updateResponse = "invalid {{ json";

                        ServerUtil.testMessageCallback = (requestBody: any) => {
                            try {
                                assert.equal(ServerUtil.TestMessage.CHECK_ERROR, requestBody.message);
                                done();
                            } catch (e) {
                                done(e);
                            }
                        };

                        projectManager.runApplication(TestConfig.testRunDirectory, targetPlatform);
                    });
            }, ScenarioCheckForUpdatePath);
        
        TestBuilder.describe("#window.codePush.checkForUpdate.customKey",
            () => {
                TestBuilder.it("window.codePush.checkForUpdate.customKey.update", false,
                    (done: MochaDone) => {
                        var updateResponse = ServerUtil.createUpdateResponse();
                        ServerUtil.updateResponse = { updateInfo: updateResponse };

                        ServerUtil.updateCheckCallback = (request: any) => {
                            try {
                                assert.notEqual(null, request);
                                assert.equal(request.query.deploymentKey, "CUSTOM-DEPLOYMENT-KEY");
                                done();
                            } catch (e) {
                                done(e);
                            }
                        };

                        projectManager.runApplication(TestConfig.testRunDirectory, targetPlatform);
                    });
            }, ScenarioCheckForUpdateCustomKey);
            
        TestBuilder.describe("#remotePackage.download",
            () => {
                TestBuilder.it("remotePackage.download.success", false,
                    (done: MochaDone) => {
                        ServerUtil.updateResponse = { updateInfo: ServerUtil.createUpdateResponse(false, targetPlatform) };

                        /* pass the path to any file for download (here, config.xml) to make sure the download completed callback is invoked */
                        ServerUtil.updatePackagePath = path.join(TestConfig.templatePath, "config.xml");

                        ServerUtil.testMessageCallback = (requestBody: any) => {
                            try {
                                assert.equal(ServerUtil.TestMessage.DOWNLOAD_SUCCEEDED, requestBody.message);
                                done();
                            } catch (e) {
                                done(e);
                            }
                        };

                        projectManager.runApplication(TestConfig.testRunDirectory, targetPlatform);
                    });
                
                TestBuilder.it("remotePackage.download.error", false,
                    (done: MochaDone) => {
                        ServerUtil.updateResponse = { updateInfo: ServerUtil.createUpdateResponse(false, targetPlatform) };

                        /* pass an invalid update url */
                        ServerUtil.updateResponse.updateInfo.downloadURL = "invalid_url";

                        ServerUtil.testMessageCallback = (requestBody: any) => {
                            try {
                                assert.equal(ServerUtil.TestMessage.DOWNLOAD_ERROR, requestBody.message);
                                done();
                            } catch (e) {
                                done(e);
                            }
                        };

                        projectManager.runApplication(TestConfig.testRunDirectory, targetPlatform);
                    });
            }, ScenarioDownloadUpdate);
            
        TestBuilder.describe("#localPackage.install",
            () => {
                TestBuilder.it("localPackage.install.unzip.error", false,
                    (done: MochaDone) => {
                        ServerUtil.updateResponse = { updateInfo: ServerUtil.createUpdateResponse(false, targetPlatform) };

                        /* pass an invalid zip file, here, config.xml */
                        ServerUtil.updatePackagePath = path.join(TestConfig.templatePath, "config.xml");

                        ServerUtil.testMessageCallback = (requestBody: any) => {
                            try {
                                assert.equal(ServerUtil.TestMessage.INSTALL_ERROR, requestBody.message);
                                done();
                            } catch (e) {
                                done(e);
                            }
                        };

                        projectManager.runApplication(TestConfig.testRunDirectory, targetPlatform);
                    });
                
                TestBuilder.it("localPackage.install.handlesDiff.againstBinary", false,
                    (done: MochaDone) => {
                        ServerUtil.updateResponse = { updateInfo: ServerUtil.createUpdateResponse(false, targetPlatform) };

                        /* create an update */
                        setupUpdateScenario(projectManager, targetPlatform, UpdateNotifyApplicationReady, "Diff Update 1")
                            .then<void>((updatePath: string) => {
                                ServerUtil.updatePackagePath = updatePath;
                                projectManager.runApplication(TestConfig.testRunDirectory, targetPlatform);
                                return ServerUtil.expectTestMessages([
                                    ServerUtil.TestMessage.UPDATE_INSTALLED, 
                                    ServerUtil.TestMessage.DEVICE_READY_AFTER_UPDATE, 
                                    ServerUtil.TestMessage.NOTIFY_APP_READY_SUCCESS]);
                            })
                            .then<void>(() => {
                                /* run the app again to ensure it was not reverted */
                                targetPlatform.getEmulatorManager().restartApplication(TestConfig.TestNamespace);
                                return ServerUtil.expectTestMessages([
                                    ServerUtil.TestMessage.DEVICE_READY_AFTER_UPDATE, 
                                    ServerUtil.TestMessage.NOTIFY_APP_READY_SUCCESS]);
                            })
                            .done(() => { done(); }, (e) => { done(e); });
                    });
                
                TestBuilder.it("localPackage.install.immediately", false,
                    (done: MochaDone) => {
                        ServerUtil.updateResponse = { updateInfo: ServerUtil.createUpdateResponse(false, targetPlatform) };

                        /* create an update */
                        setupUpdateScenario(projectManager, targetPlatform, UpdateNotifyApplicationReady, "Update 1")
                            .then<void>((updatePath: string) => {
                                ServerUtil.updatePackagePath = updatePath;
                                projectManager.runApplication(TestConfig.testRunDirectory, targetPlatform);
                                return ServerUtil.expectTestMessages([
                                    ServerUtil.TestMessage.UPDATE_INSTALLED, 
                                    ServerUtil.TestMessage.DEVICE_READY_AFTER_UPDATE, 
                                    ServerUtil.TestMessage.NOTIFY_APP_READY_SUCCESS]);
                            })
                            .then<void>(() => {
                                /* run the app again to ensure it was not reverted */
                                targetPlatform.getEmulatorManager().restartApplication(TestConfig.TestNamespace);
                                return ServerUtil.expectTestMessages([
                                    ServerUtil.TestMessage.DEVICE_READY_AFTER_UPDATE, 
                                    ServerUtil.TestMessage.NOTIFY_APP_READY_SUCCESS]);
                            })
                            .done(() => { done(); }, (e) => { done(e); });
                    });
            }, ScenarioInstall);
            
        TestBuilder.describe("#localPackage.install.revert",
            () => {
                TestBuilder.it("localPackage.install.revert.dorevert", false,
                    (done: MochaDone) => {
                        ServerUtil.updateResponse = { updateInfo: ServerUtil.createUpdateResponse(false, targetPlatform) };

                        /* create an update */
                        setupUpdateScenario(projectManager, targetPlatform, UpdateDeviceReady, "Update 1 (bad update)")
                            .then<void>((updatePath: string) => {
                                ServerUtil.updatePackagePath = updatePath;
                                projectManager.runApplication(TestConfig.testRunDirectory, targetPlatform);
                                return ServerUtil.expectTestMessages([
                                    ServerUtil.TestMessage.UPDATE_INSTALLED, 
                                    ServerUtil.TestMessage.DEVICE_READY_AFTER_UPDATE]);
                            })
                            .then<void>(() => {
                                /* run the app again to ensure it was reverted */
                                targetPlatform.getEmulatorManager().restartApplication(TestConfig.TestNamespace);
                                return ServerUtil.expectTestMessages([ServerUtil.TestMessage.UPDATE_FAILED_PREVIOUSLY]);
                            })
                            .then<void>(() => {
                                /* create a second failed update */
                                console.log("Creating a second failed update.");
                                ServerUtil.updateResponse = { updateInfo: ServerUtil.createUpdateResponse(false, targetPlatform) };
                                targetPlatform.getEmulatorManager().restartApplication(TestConfig.TestNamespace);
                                return ServerUtil.expectTestMessages([
                                    ServerUtil.TestMessage.UPDATE_INSTALLED, 
                                    ServerUtil.TestMessage.DEVICE_READY_AFTER_UPDATE]);
                            })
                            .then<void>(() => {
                                /* run the app again to ensure it was reverted */
                                targetPlatform.getEmulatorManager().restartApplication(TestConfig.TestNamespace);
                                return ServerUtil.expectTestMessages([ServerUtil.TestMessage.UPDATE_FAILED_PREVIOUSLY]);
                            })
                            .done(() => { done(); }, (e) => { done(e); });
                    });
                
                TestBuilder.it("localPackage.install.revert.norevert", false,
                    (done: MochaDone) => {
                        ServerUtil.updateResponse = { updateInfo: ServerUtil.createUpdateResponse(false, targetPlatform) };

                        /* create an update */
                        setupUpdateScenario(projectManager, targetPlatform, UpdateNotifyApplicationReady, "Update 1 (good update)")
                            .then<void>((updatePath: string) => {
                                ServerUtil.updatePackagePath = updatePath;
                                projectManager.runApplication(TestConfig.testRunDirectory, targetPlatform);
                                return ServerUtil.expectTestMessages([
                                    ServerUtil.TestMessage.UPDATE_INSTALLED, 
                                    ServerUtil.TestMessage.DEVICE_READY_AFTER_UPDATE, 
                                    ServerUtil.TestMessage.NOTIFY_APP_READY_SUCCESS]);
                            })
                            .then<void>(() => {
                                /* run the app again to ensure it was not reverted */
                                targetPlatform.getEmulatorManager().restartApplication(TestConfig.TestNamespace);
                                return ServerUtil.expectTestMessages([
                                    ServerUtil.TestMessage.DEVICE_READY_AFTER_UPDATE, 
                                    ServerUtil.TestMessage.NOTIFY_APP_READY_SUCCESS]);
                            })
                            .done(() => { done(); }, (e) => { done(e); });
                    });
            }, ScenarioInstallWithRevert);
        
        TestBuilder.describe("#localPackage.installOnNextResume",
            () => {
                TestBuilder.it("localPackage.installOnNextResume.dorevert", true,
                    (done: MochaDone) => {
                        ServerUtil.updateResponse = { updateInfo: ServerUtil.createUpdateResponse(false, targetPlatform) };

                        setupUpdateScenario(projectManager, targetPlatform, UpdateDeviceReady, "Update 1")
                            .then<void>((updatePath: string) => {
                                ServerUtil.updatePackagePath = updatePath;
                                projectManager.runApplication(TestConfig.testRunDirectory, targetPlatform);
                                return ServerUtil.expectTestMessages([ServerUtil.TestMessage.UPDATE_INSTALLED]);
                            })
                            .then<void>(() => {
                                /* resume the application */
                                targetPlatform.getEmulatorManager().resumeApplication(TestConfig.TestNamespace);
                                return ServerUtil.expectTestMessages([ServerUtil.TestMessage.DEVICE_READY_AFTER_UPDATE]);
                            })
                            .then<void>(() => {
                                /* restart to revert it */
                                targetPlatform.getEmulatorManager().restartApplication(TestConfig.TestNamespace);
                                return ServerUtil.expectTestMessages([ServerUtil.TestMessage.UPDATE_FAILED_PREVIOUSLY]);
                            })
                            .done(() => { done(); }, (e) => { done(e); });
                    });
                
                TestBuilder.it("localPackage.installOnNextResume.norevert", false,
                    (done: MochaDone) => {
                        ServerUtil.updateResponse = { updateInfo: ServerUtil.createUpdateResponse(false, targetPlatform) };

                        /* create an update */
                        setupUpdateScenario(projectManager, targetPlatform, UpdateNotifyApplicationReady, "Update 1 (good update)")
                            .then<void>((updatePath: string) => {
                                ServerUtil.updatePackagePath = updatePath;
                                projectManager.runApplication(TestConfig.testRunDirectory, targetPlatform);
                                return ServerUtil.expectTestMessages([ServerUtil.TestMessage.UPDATE_INSTALLED]);
                            })
                            .then<void>(() => {
                                /* resume the application */
                                targetPlatform.getEmulatorManager().resumeApplication(TestConfig.TestNamespace);
                                return ServerUtil.expectTestMessages([
                                    ServerUtil.TestMessage.DEVICE_READY_AFTER_UPDATE, 
                                    ServerUtil.TestMessage.NOTIFY_APP_READY_SUCCESS]);
                            })
                            .then<void>(() => {
                                /* restart to make sure it did not revert */
                                targetPlatform.getEmulatorManager().restartApplication(TestConfig.TestNamespace);
                                return ServerUtil.expectTestMessages([
                                    ServerUtil.TestMessage.DEVICE_READY_AFTER_UPDATE, 
                                    ServerUtil.TestMessage.NOTIFY_APP_READY_SUCCESS]);
                            })
                            .done(() => { done(); }, (e) => { done(e); });
                    });
            }, ScenarioInstallOnResumeWithRevert);
            
        TestBuilder.describe("localPackage installOnNextRestart",
            () => {
                TestBuilder.it("localPackage.installOnNextRestart.dorevert", false,
                    (done: MochaDone) => {
                        ServerUtil.updateResponse = { updateInfo: ServerUtil.createUpdateResponse(false, targetPlatform) };

                        setupUpdateScenario(projectManager, targetPlatform, UpdateDeviceReady, "Update 1")
                            .then<void>((updatePath: string) => {
                                ServerUtil.updatePackagePath = updatePath;
                                projectManager.runApplication(TestConfig.testRunDirectory, targetPlatform);
                                return ServerUtil.expectTestMessages([ServerUtil.TestMessage.UPDATE_INSTALLED]);
                            })
                            .then<void>(() => {
                                /* restart the application */
                                console.log("Update hash: " + ServerUtil.updateResponse.updateInfo.packageHash);
                                targetPlatform.getEmulatorManager().restartApplication(TestConfig.TestNamespace);
                                return ServerUtil.expectTestMessages([ServerUtil.TestMessage.DEVICE_READY_AFTER_UPDATE]);
                            })
                            .then<void>(() => {
                                /* restart the application */
                                console.log("Update hash: " + ServerUtil.updateResponse.updateInfo.packageHash);
                                targetPlatform.getEmulatorManager().restartApplication(TestConfig.TestNamespace);
                                return ServerUtil.expectTestMessages([ServerUtil.TestMessage.UPDATE_FAILED_PREVIOUSLY]);
                            })
                            .done(() => { done(); }, (e) => { done(e); });
                    });
                
                TestBuilder.it("localPackage.installOnNextRestart.norevert", true,
                    (done: MochaDone) => {
                        ServerUtil.updateResponse = { updateInfo: ServerUtil.createUpdateResponse(false, targetPlatform) };

                        /* create an update */
                        setupUpdateScenario(projectManager, targetPlatform, UpdateNotifyApplicationReady, "Update 1 (good update)")
                            .then<void>((updatePath: string) => {
                                ServerUtil.updatePackagePath = updatePath;
                                projectManager.runApplication(TestConfig.testRunDirectory, targetPlatform);
                                return ServerUtil.expectTestMessages([ServerUtil.TestMessage.UPDATE_INSTALLED]);
                            })
                            .then<void>(() => {
                                /* "resume" the application - run it again */
                                targetPlatform.getEmulatorManager().restartApplication(TestConfig.TestNamespace);
                                return ServerUtil.expectTestMessages([
                                    ServerUtil.TestMessage.DEVICE_READY_AFTER_UPDATE, 
                                    ServerUtil.TestMessage.NOTIFY_APP_READY_SUCCESS]);
                            })
                            .then<void>(() => {
                                /* run again to make sure it did not revert */
                                targetPlatform.getEmulatorManager().restartApplication(TestConfig.TestNamespace);
                                return ServerUtil.expectTestMessages([
                                    ServerUtil.TestMessage.DEVICE_READY_AFTER_UPDATE, 
                                    ServerUtil.TestMessage.NOTIFY_APP_READY_SUCCESS]);
                            })
                            .done(() => { done(); }, (e) => { done(e); });
                    });
                
                TestBuilder.it("localPackage.installOnNextRestart.revertToPrevious", false,
                    (done: MochaDone) => {
                        ServerUtil.updateResponse = { updateInfo: ServerUtil.createUpdateResponse(false, targetPlatform) };

                        /* create an update */
                        setupUpdateScenario(projectManager, targetPlatform, UpdateNotifyApplicationReadyConditional, "Update 1 (good update)")
                            .then<void>((updatePath: string) => {
                                ServerUtil.updatePackagePath = updatePath;
                                projectManager.runApplication(TestConfig.testRunDirectory, targetPlatform);
                                return ServerUtil.expectTestMessages([ServerUtil.TestMessage.UPDATE_INSTALLED]);
                            })
                            .then<void>(() => {
                                /* run good update, set up another (bad) update */
                                ServerUtil.updateResponse = { updateInfo: ServerUtil.createUpdateResponse(false, targetPlatform) };
                                setupUpdateScenario(projectManager, targetPlatform, UpdateDeviceReady, "Update 2 (bad update)")
                                    .then(() => { return targetPlatform.getEmulatorManager().restartApplication(TestConfig.TestNamespace); });
                                return ServerUtil.expectTestMessages([
                                    ServerUtil.TestMessage.DEVICE_READY_AFTER_UPDATE, 
                                    ServerUtil.TestMessage.NOTIFY_APP_READY_SUCCESS, ServerUtil.TestMessage.UPDATE_INSTALLED]);
                            })
                            .then<void>(() => {
                                /* run the bad update without calling notifyApplicationReady */
                                targetPlatform.getEmulatorManager().restartApplication(TestConfig.TestNamespace);
                                return ServerUtil.expectTestMessages([ServerUtil.TestMessage.DEVICE_READY_AFTER_UPDATE]);
                            })
                            .then<void>(() => {
                                /* run the good update and don't call notifyApplicationReady - it should not revert */
                                ServerUtil.testMessageResponse = ServerUtil.TestMessageResponse.SKIP_NOTIFY_APPLICATION_READY;
                                targetPlatform.getEmulatorManager().restartApplication(TestConfig.TestNamespace);
                                return ServerUtil.expectTestMessages([
                                    ServerUtil.TestMessage.DEVICE_READY_AFTER_UPDATE, 
                                    ServerUtil.TestMessage.SKIPPED_NOTIFY_APPLICATION_READY]);
                            })
                            .then<void>(() => {
                                /* run the application again */
                                ServerUtil.testMessageResponse = undefined;
                                targetPlatform.getEmulatorManager().restartApplication(TestConfig.TestNamespace);
                                return ServerUtil.expectTestMessages([
                                    ServerUtil.TestMessage.DEVICE_READY_AFTER_UPDATE, 
                                    ServerUtil.TestMessage.NOTIFY_APP_READY_SUCCESS, 
                                    ServerUtil.TestMessage.UPDATE_FAILED_PREVIOUSLY]);
                            })
                            .done(() => { done(); }, (e) => { done(e); });
                    });
            }, ScenarioInstallOnRestartWithRevert);
            
        TestBuilder.describe("#localPackage.installOnNextRestart2x",
            () => {
                TestBuilder.it("localPackage.installOnNextRestart2x.revertToFirst", false,
                    (done: MochaDone) => {
                        ServerUtil.updateResponse = { updateInfo: ServerUtil.createUpdateResponse(false, targetPlatform) };
                        
                        ServerUtil.updateCheckCallback = () => {
                            // Update the packageHash so we can install the same update twice.
                            ServerUtil.updateResponse.packageHash = "randomHash-" + Math.floor(Math.random() * 10000);
                        };

                        /* create an update */
                        setupUpdateScenario(projectManager, targetPlatform, UpdateDeviceReady, "Bad Update")
                            .then<void>((updatePath: string) => {
                                ServerUtil.updatePackagePath = updatePath;
                                projectManager.runApplication(TestConfig.testRunDirectory, targetPlatform);
                                return ServerUtil.expectTestMessages([
                                    ServerUtil.TestMessage.UPDATE_INSTALLED, 
                                    ServerUtil.TestMessage.UPDATE_INSTALLED]);
                            })
                            .then<void>(() => {
                                /* verify that the bad update is run, then restart it */
                                targetPlatform.getEmulatorManager().restartApplication(TestConfig.TestNamespace);
                                return ServerUtil.expectTestMessages([ServerUtil.TestMessage.DEVICE_READY_AFTER_UPDATE]);
                            })
                            .then<void>(() => {
                                /* verify the app rolls back to the binary, ignoring the first unconfirmed version */
                                targetPlatform.getEmulatorManager().restartApplication(TestConfig.TestNamespace);
                                return ServerUtil.expectTestMessages([ServerUtil.TestMessage.UPDATE_FAILED_PREVIOUSLY]);
                            })
                            .done(() => { done(); }, (e) => { done(e); });
                    });
            }, ScenarioInstallOnRestart2xWithRevert);
            
        TestBuilder.describe("#codePush.restartApplication",
            () => {
                TestBuilder.it("codePush.restartApplication.checkPackages", true,
                    (done: MochaDone) => {
                        ServerUtil.updateResponse = { updateInfo: ServerUtil.createUpdateResponse(false, targetPlatform) };

                        setupUpdateScenario(projectManager, targetPlatform, UpdateNotifyApplicationReady, "Update 1")
                            .then<void>((updatePath: string) => {
                                ServerUtil.updatePackagePath = updatePath;
                                projectManager.runApplication(TestConfig.testRunDirectory, targetPlatform);
                                return ServerUtil.expectTestMessages([
                                    new ServerUtil.AppMessage(ServerUtil.TestMessage.PENDING_PACKAGE, [null]),
                                    new ServerUtil.AppMessage(ServerUtil.TestMessage.CURRENT_PACKAGE, [null]),
                                    new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_CHECKING_FOR_UPDATE]),
                                    new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_DOWNLOADING_PACKAGE]),
                                    new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_INSTALLING_UPDATE]),
                                    new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_UPDATE_INSTALLED]),
                                    new ServerUtil.AppMessage(ServerUtil.TestMessage.PENDING_PACKAGE, [ServerUtil.updateResponse.updateInfo.packageHash]),
                                    new ServerUtil.AppMessage(ServerUtil.TestMessage.CURRENT_PACKAGE, [null]),
                                    ServerUtil.TestMessage.DEVICE_READY_AFTER_UPDATE,
                                    ServerUtil.TestMessage.NOTIFY_APP_READY_SUCCESS]);
                            })
                            .then<void>(() => {
                                /* restart the application */
                                targetPlatform.getEmulatorManager().restartApplication(TestConfig.TestNamespace);
                                return ServerUtil.expectTestMessages([
                                    ServerUtil.TestMessage.DEVICE_READY_AFTER_UPDATE, 
                                    ServerUtil.TestMessage.NOTIFY_APP_READY_SUCCESS]);
                            })
                            .done(() => { done(); }, (e) => { done(e); });
                    });
            }, ScenarioRestart);
            
        TestBuilder.describe("#window.codePush.sync",
            () => {
                // We test the functionality with sync twice--first, with sync only called once,
                // then, with sync called again while the first sync is still running.
                TestBuilder.describe("#window.codePush.sync 1x",
                    () => {
                        // Tests where sync is called just once
                        TestBuilder.it("window.codePush.sync.noupdate", false,
                            (done: MochaDone) => {
                                var noUpdateResponse = ServerUtil.createDefaultResponse();
                                noUpdateResponse.isAvailable = false;
                                noUpdateResponse.appVersion = "0.0.1";
                                ServerUtil.updateResponse = { updateInfo: noUpdateResponse };

                                Q({})
                                    .then<void>(p => {
                                        projectManager.runApplication(TestConfig.testRunDirectory, targetPlatform);
                                        return ServerUtil.expectTestMessages([
                                            new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_CHECKING_FOR_UPDATE]),
                                            new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_UP_TO_DATE])]);
                                    })
                                    .done(() => { done(); }, (e) => { done(e); });
                            });
                        
                        TestBuilder.it("window.codePush.sync.checkerror", false,
                            (done: MochaDone) => {
                                ServerUtil.updateResponse = "invalid {{ json";

                                Q({})
                                    .then<void>(p => {
                                        projectManager.runApplication(TestConfig.testRunDirectory, targetPlatform);
                                        return ServerUtil.expectTestMessages([
                                            new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_CHECKING_FOR_UPDATE]),
                                            new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_ERROR])]);
                                    })
                                    .done(() => { done(); }, (e) => { done(e); });
                            });
                        
                        TestBuilder.it("window.codePush.sync.downloaderror", false,
                            (done: MochaDone) => {
                                var invalidUrlResponse = ServerUtil.createUpdateResponse();
                                invalidUrlResponse.downloadURL = path.join(TestConfig.templatePath, "invalid_path.zip");
                                ServerUtil.updateResponse = { updateInfo: invalidUrlResponse };

                                Q({})
                                    .then<void>(p => {
                                        projectManager.runApplication(TestConfig.testRunDirectory, targetPlatform);
                                        return ServerUtil.expectTestMessages([
                                            new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_CHECKING_FOR_UPDATE]),
                                            new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_DOWNLOADING_PACKAGE]),
                                            new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_ERROR])]);
                                    })
                                    .done(() => { done(); }, (e) => { done(e); });
                            });
                        
                        TestBuilder.it("window.codePush.sync.dorevert", false,
                            (done: MochaDone) => {
                                ServerUtil.updateResponse = { updateInfo: ServerUtil.createUpdateResponse(false, targetPlatform) };
                            
                                /* create an update */
                                setupUpdateScenario(projectManager, targetPlatform, UpdateDeviceReady, "Update 1 (bad update)")
                                    .then<void>((updatePath: string) => {
                                        ServerUtil.updatePackagePath = updatePath;
                                        projectManager.runApplication(TestConfig.testRunDirectory, targetPlatform);
                                        return ServerUtil.expectTestMessages([
                                            new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_CHECKING_FOR_UPDATE]),
                                            new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_DOWNLOADING_PACKAGE]),
                                            new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_INSTALLING_UPDATE]),
                                            new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_UPDATE_INSTALLED]),
                                            ServerUtil.TestMessage.DEVICE_READY_AFTER_UPDATE]);
                                    })
                                    .then<void>(() => {
                                        targetPlatform.getEmulatorManager().restartApplication(TestConfig.TestNamespace);
                                        return ServerUtil.expectTestMessages([
                                            new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_CHECKING_FOR_UPDATE]),
                                            new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_UP_TO_DATE])]);
                                    })
                                    .done(() => { done(); }, (e) => { done(e); });
                            });
                        
                        TestBuilder.it("window.codePush.sync.update", false,
                            (done: MochaDone) => {
                                ServerUtil.updateResponse = { updateInfo: ServerUtil.createUpdateResponse(false, targetPlatform) };

                                /* create an update */
                                setupUpdateScenario(projectManager, targetPlatform, UpdateSync, "Update 1 (good update)")
                                    .then<void>((updatePath: string) => {
                                        ServerUtil.updatePackagePath = updatePath;
                                        projectManager.runApplication(TestConfig.testRunDirectory, targetPlatform);
                                        return ServerUtil.expectTestMessages([
                                            new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_CHECKING_FOR_UPDATE]),
                                            new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_DOWNLOADING_PACKAGE]),
                                            new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_INSTALLING_UPDATE]),
                                            new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_UPDATE_INSTALLED]),
                                            // the update is immediate so the update will install
                                            ServerUtil.TestMessage.DEVICE_READY_AFTER_UPDATE]);
                                    })
                                    .then<void>(() => {
                                        // restart the app and make sure it didn't roll out!
                                        var noUpdateResponse = ServerUtil.createDefaultResponse();
                                        noUpdateResponse.isAvailable = false;
                                        noUpdateResponse.appVersion = "0.0.1";
                                        ServerUtil.updateResponse = { updateInfo: noUpdateResponse };
                                        targetPlatform.getEmulatorManager().restartApplication(TestConfig.TestNamespace);
                                        return ServerUtil.expectTestMessages([ServerUtil.TestMessage.DEVICE_READY_AFTER_UPDATE]);
                                    })
                                    .done(() => { done(); }, (e) => { done(e); });
                            });
                        
                    }, ScenarioSync1x);
                    
                TestBuilder.describe("#window.codePush.sync 2x",
                    () => {
                        // Tests where sync is called again before the first sync finishes
                        TestBuilder.it("window.codePush.sync.2x.noupdate", false,
                            (done: MochaDone) => {
                                var noUpdateResponse = ServerUtil.createDefaultResponse();
                                noUpdateResponse.isAvailable = false;
                                noUpdateResponse.appVersion = "0.0.1";
                                ServerUtil.updateResponse = { updateInfo: noUpdateResponse };

                                Q({})
                                    .then<void>(p => {
                                        projectManager.runApplication(TestConfig.testRunDirectory, targetPlatform);
                                        return ServerUtil.expectTestMessages([
                                            new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_CHECKING_FOR_UPDATE]),
                                            new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_IN_PROGRESS]),
                                            new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_UP_TO_DATE])]);
                                    })
                                    .done(() => { done(); }, (e) => { done(e); });
                            });
                        
                        TestBuilder.it("window.codePush.sync.2x.checkerror", false,
                            (done: MochaDone) => {
                                ServerUtil.updateResponse = "invalid {{ json";

                                Q({})
                                    .then<void>(p => {
                                        projectManager.runApplication(TestConfig.testRunDirectory, targetPlatform);
                                        return ServerUtil.expectTestMessages([
                                            new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_CHECKING_FOR_UPDATE]),
                                            new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_IN_PROGRESS]),
                                            new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_ERROR])]);
                                    })
                                    .done(() => { done(); }, (e) => { done(e); });
                            });
                        
                        TestBuilder.it("window.codePush.sync.2x.downloaderror", false,
                            (done: MochaDone) => {
                                var invalidUrlResponse = ServerUtil.createUpdateResponse();
                                invalidUrlResponse.downloadURL = path.join(TestConfig.templatePath, "invalid_path.zip");
                                ServerUtil.updateResponse = { updateInfo: invalidUrlResponse };

                                Q({})
                                    .then<void>(p => {
                                        projectManager.runApplication(TestConfig.testRunDirectory, targetPlatform);
                                        return ServerUtil.expectTestMessages([
                                            new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_CHECKING_FOR_UPDATE]),
                                            new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_IN_PROGRESS]),
                                            new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_DOWNLOADING_PACKAGE]),
                                            new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_ERROR])]);
                                    })
                                    .done(() => { done(); }, (e) => { done(e); });
                            });
                        
                        TestBuilder.it("window.codePush.sync.2x.dorevert", false,
                            (done: MochaDone) => {
                                ServerUtil.updateResponse = { updateInfo: ServerUtil.createUpdateResponse(false, targetPlatform) };
                        
                                /* create an update */
                                setupUpdateScenario(projectManager, targetPlatform, UpdateDeviceReady, "Update 1 (bad update)")
                                    .then<void>((updatePath: string) => {
                                        ServerUtil.updatePackagePath = updatePath;
                                        projectManager.runApplication(TestConfig.testRunDirectory, targetPlatform);
                                        return ServerUtil.expectTestMessages([
                                            new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_CHECKING_FOR_UPDATE]),
                                            new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_IN_PROGRESS]),
                                            new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_DOWNLOADING_PACKAGE]),
                                            new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_INSTALLING_UPDATE]),
                                            new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_UPDATE_INSTALLED]),
                                            ServerUtil.TestMessage.DEVICE_READY_AFTER_UPDATE]);
                                    })
                                    .then<void>(() => {
                                        targetPlatform.getEmulatorManager().restartApplication(TestConfig.TestNamespace);
                                        return ServerUtil.expectTestMessages([
                                            new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_CHECKING_FOR_UPDATE]),
                                            new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_IN_PROGRESS]),
                                            new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_UP_TO_DATE])]);
                                    })
                                    .done(() => { done(); }, (e) => { done(e); });
                            });
                        
                        TestBuilder.it("window.codePush.sync.2x.update", true,
                            (done: MochaDone) => {
                                ServerUtil.updateResponse = { updateInfo: ServerUtil.createUpdateResponse(false, targetPlatform) };

                                /* create an update */
                                setupUpdateScenario(projectManager, targetPlatform, UpdateSync2x, "Update 1 (good update)")
                                    .then<void>((updatePath: string) => {
                                        ServerUtil.updatePackagePath = updatePath;
                                        projectManager.runApplication(TestConfig.testRunDirectory, targetPlatform);
                                        return ServerUtil.expectTestMessages([
                                            new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_CHECKING_FOR_UPDATE]),
                                            new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_IN_PROGRESS]),
                                            new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_DOWNLOADING_PACKAGE]),
                                            new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_INSTALLING_UPDATE]),
                                            new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_UPDATE_INSTALLED]),
                                            // the update is immediate so the update will install
                                            ServerUtil.TestMessage.DEVICE_READY_AFTER_UPDATE,
                                            new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_IN_PROGRESS])]);
                                    })
                                    .then<void>(() => {
                                        // restart the app and make sure it didn't roll out!
                                        var noUpdateResponse = ServerUtil.createDefaultResponse();
                                        noUpdateResponse.isAvailable = false;
                                        noUpdateResponse.appVersion = "0.0.1";
                                        ServerUtil.updateResponse = { updateInfo: noUpdateResponse };
                                        targetPlatform.getEmulatorManager().restartApplication(TestConfig.TestNamespace);
                                        return ServerUtil.expectTestMessages([
                                            ServerUtil.TestMessage.DEVICE_READY_AFTER_UPDATE,
                                            new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_IN_PROGRESS])]);
                                    })
                                    .done(() => { done(); }, (e) => { done(e); });
                            });
                    }, ScenarioSync2x);
            });
        
        TestBuilder.describe("#window.codePush.sync minimum background duration tests",
            () => {
                TestBuilder.it("defaults to no minimum", false,
                    (done: MochaDone) => {
                        ServerUtil.updateResponse = { updateInfo: ServerUtil.createUpdateResponse(false, targetPlatform) };

                        setupTestRunScenario(projectManager, targetPlatform, ScenarioSyncResume).then<string>(() => {
                                return setupUpdateScenario(projectManager, targetPlatform, UpdateSync, "Update 1 (good update)");
                            })
                            .then<void>((updatePath: string) => {
                                ServerUtil.updatePackagePath = updatePath;
                                projectManager.runApplication(TestConfig.testRunDirectory, targetPlatform);
                                return ServerUtil.expectTestMessages([
                                    new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_UPDATE_INSTALLED])]);
                            })
                            .then<void>(() => {
                                var noUpdateResponse = ServerUtil.createDefaultResponse();
                                noUpdateResponse.isAvailable = false;
                                noUpdateResponse.appVersion = "0.0.1";
                                ServerUtil.updateResponse = { updateInfo: noUpdateResponse };
                                targetPlatform.getEmulatorManager().resumeApplication(TestConfig.TestNamespace);
                                return ServerUtil.expectTestMessages([ServerUtil.TestMessage.DEVICE_READY_AFTER_UPDATE]);
                            })
                            .done(() => { done(); }, (e) => { done(e); });
                    });
                
                TestBuilder.it("min background duration 5s", false,
                    (done: MochaDone) => {
                        ServerUtil.updateResponse = { updateInfo: ServerUtil.createUpdateResponse(false, targetPlatform) };

                        setupTestRunScenario(projectManager, targetPlatform, ScenarioSyncResumeDelay).then<string>(() => {
                                return setupUpdateScenario(projectManager, targetPlatform, UpdateSync, "Update 1 (good update)");
                            })
                            .then((updatePath: string) => {
                                ServerUtil.updatePackagePath = updatePath;
                                projectManager.runApplication(TestConfig.testRunDirectory, targetPlatform);
                                return ServerUtil.expectTestMessages([
                                    new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_UPDATE_INSTALLED])]);
                            })
                            .then(() => {
                                var noUpdateResponse = ServerUtil.createDefaultResponse();
                                noUpdateResponse.isAvailable = false;
                                noUpdateResponse.appVersion = "0.0.1";
                                ServerUtil.updateResponse = { updateInfo: noUpdateResponse };
                                return targetPlatform.getEmulatorManager().resumeApplication(TestConfig.TestNamespace, 3 * 1000);
                            })
                            .then(() => {
                                targetPlatform.getEmulatorManager().resumeApplication(TestConfig.TestNamespace, 6 * 1000);
                                return ServerUtil.expectTestMessages([ServerUtil.TestMessage.DEVICE_READY_AFTER_UPDATE]);
                            })
                            .done(() => { done(); }, (e) => { done(e); });
                    });
                    
                TestBuilder.it("has no effect on restart", false,
                    (done: MochaDone) => {
                        ServerUtil.updateResponse = { updateInfo: ServerUtil.createUpdateResponse(false, targetPlatform) };

                        setupTestRunScenario(projectManager, targetPlatform, ScenarioSyncRestartDelay).then<string>(() => {
                                return setupUpdateScenario(projectManager, targetPlatform, UpdateSync, "Update 1 (good update)");
                            })
                            .then<void>((updatePath: string) => {
                                ServerUtil.updatePackagePath = updatePath;
                                projectManager.runApplication(TestConfig.testRunDirectory, targetPlatform);
                                return ServerUtil.expectTestMessages([
                                    new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_UPDATE_INSTALLED])]);
                            })
                            .then<void>(() => {
                                var noUpdateResponse = ServerUtil.createDefaultResponse();
                                noUpdateResponse.isAvailable = false;
                                noUpdateResponse.appVersion = "0.0.1";
                                ServerUtil.updateResponse = { updateInfo: noUpdateResponse };
                                targetPlatform.getEmulatorManager().restartApplication(TestConfig.TestNamespace);
                                return ServerUtil.expectTestMessages([ServerUtil.TestMessage.DEVICE_READY_AFTER_UPDATE]);
                            })
                            .done(() => { done(); }, (e) => { done(e); });
                    });
            });
            
        TestBuilder.describe("#window.codePush.sync mandatory install mode tests",
            () => {
                TestBuilder.it("defaults to IMMEDIATE", false,
                    (done: MochaDone) => {
                        ServerUtil.updateResponse = { updateInfo: ServerUtil.createUpdateResponse(true, targetPlatform) };

                        setupTestRunScenario(projectManager, targetPlatform, ScenarioSyncMandatoryDefault).then<string>(() => {
                                return setupUpdateScenario(projectManager, targetPlatform, UpdateDeviceReady, "Update 1 (good update)");
                            })
                            .then<void>((updatePath: string) => {
                                ServerUtil.updatePackagePath = updatePath;
                                projectManager.runApplication(TestConfig.testRunDirectory, targetPlatform);
                                return ServerUtil.expectTestMessages([
                                    new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_UPDATE_INSTALLED]),
                                    ServerUtil.TestMessage.DEVICE_READY_AFTER_UPDATE]);
                            })
                            .done(() => { done(); }, (e) => { done(e); });
                    });
                    
                TestBuilder.it("works correctly when update is mandatory and mandatory install mode is specified", false,
                    (done: MochaDone) => {
                        ServerUtil.updateResponse = { updateInfo: ServerUtil.createUpdateResponse(true, targetPlatform) };

                        setupTestRunScenario(projectManager, targetPlatform, ScenarioSyncMandatoryResume).then<string>(() => {
                                return setupUpdateScenario(projectManager, targetPlatform, UpdateDeviceReady, "Update 1 (good update)");
                            })
                            .then<void>((updatePath: string) => {
                                ServerUtil.updatePackagePath = updatePath;
                                projectManager.runApplication(TestConfig.testRunDirectory, targetPlatform);
                                return ServerUtil.expectTestMessages([
                                    new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_UPDATE_INSTALLED])]);
                            })
                            .then<void>(() => {
                                var noUpdateResponse = ServerUtil.createDefaultResponse();
                                noUpdateResponse.isAvailable = false;
                                noUpdateResponse.appVersion = "0.0.1";
                                ServerUtil.updateResponse = { updateInfo: noUpdateResponse };
                                targetPlatform.getEmulatorManager().resumeApplication(TestConfig.TestNamespace, 5 * 1000);
                                return ServerUtil.expectTestMessages([ServerUtil.TestMessage.DEVICE_READY_AFTER_UPDATE]);
                            })
                            .done(() => { done(); }, (e) => { done(e); });
                    });
                    
                TestBuilder.it("has no effect on updates that are not mandatory", false,
                    (done: MochaDone) => {
                        ServerUtil.updateResponse = { updateInfo: ServerUtil.createUpdateResponse(false, targetPlatform) };

                        setupTestRunScenario(projectManager, targetPlatform, ScenarioSyncMandatoryRestart).then<string>(() => {
                                return setupUpdateScenario(projectManager, targetPlatform, UpdateDeviceReady, "Update 1 (good update)");
                            })
                            .then<void>((updatePath: string) => {
                                ServerUtil.updatePackagePath = updatePath;
                                projectManager.runApplication(TestConfig.testRunDirectory, targetPlatform);
                                return ServerUtil.expectTestMessages([
                                    new ServerUtil.AppMessage(ServerUtil.TestMessage.SYNC_STATUS, [ServerUtil.TestMessage.SYNC_UPDATE_INSTALLED]),
                                    ServerUtil.TestMessage.DEVICE_READY_AFTER_UPDATE]);
                            })
                            .done(() => { done(); }, (e) => { done(e); });
                    });
            });
    });