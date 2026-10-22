System.Gadget.onSettingsClosing = settingsClosing;
var skinSetting;
var colorSettings = Array('#000000','#990000','#DEDE08','#1B5098','#ADAD9D','#067E28','#EB94C6', '#AC6C11');
var patternSettings = Array('pattern_wood.png', 'pattern_camo.png', 'pattern_steel.png');

// this draws the colour skin tiles in the settings dialog
function renderColorTiles() {

	for (i = 0; i < colorSettings.length; i++)
	{
		imgString = '<img class="tile" src="images/settings_colorTile.png" style="background-color:';
		imgString += colorSettings[i] + ';" onClick="javascript:setSkin(\'' + colorSettings[i] + '\');"/> ';

		document.write(imgString);
	}
}

// this draws the image skin tiles in the settings dialog
function renderPatternTiles() {

	for (i = 0; i < patternSettings.length; i++)
	{
		imgString = '<img class="tile" src="images/settings_colorTile.png" ';
		imgString += ' style="background: url(../images/'+patternSettings[i]+');"';
		imgString += ' onClick="javascript:setSkin(\'../images/'+patternSettings[i]+'\');"/> ';

		document.write(imgString);
	}
}

// Change the background color or image for the skin
function setSkin(skinValue) {

	// we're using a colour
	if (skinValue.charAt(0) == '#')
	{
		document.images.skin.style['background'] = "none";
		document.images.skin.style['backgroundColor'] = skinValue;
	}
	else
	{
		// we're using an image 
		document.images.skin.style['background'] = "url(../images/"+skinValue+")";
	}

	skinSetting = skinValue;
}

// load and set the skin if the skin has been set.
function loadSetting() {
    var settingExist = System.Gadget.Settings.read("settingExist");	

	if (settingExist)
	{
		setSkin(System.Gadget.Settings.read("skinSetting"));
	}
}

// save the current skin settings
function saveSettings()
{
    System.Gadget.Settings.write("skinSetting", skinSetting);
    System.Gadget.Settings.write("SettingExist", true);
}

// what do do when the settings dialog is closed
function settingsClosing(event)
{
    if (event.closeAction == event.Action.commit)
    {
        saveSettings();
    }
    else if (event.closeAction == event.Action.cancel)
    {
    }

    event.cancel = false;
}