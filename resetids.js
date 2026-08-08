function resetFileIdProperties() {
  var props = PropertiesService.getScriptProperties();
  var keys = props.getKeys();
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].indexOf("PERM_FILE_ID_") === 0 || keys[i] === "PERM_FOLDER_ID") {
      props.deleteProperty(keys[i]);
    }
  }
  Logger.log("Cleared all stored file/folder IDs.");
}