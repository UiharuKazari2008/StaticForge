////////////////////////////////////////////////////////////////////////////////
//
//  THIS CODE IS NOT APPROVED FOR USE IN/ON ANY OTHER UI ELEMENT OR PRODUCT COMPONENT.
//  Copyright (c) 2006 Microsoft Corporation.  All rights reserved.
//
////////////////////////////////////////////////////////////////////////////////

var L_SELECT_TZ_TEXT = "Heure de l'ordinateur";
var L_CONTROLPANEL_TEXT = "Changer la date et l'heure de l'ordinateur";

var L_PREVIOUS_TEXT = "Précédent";
var L_NEXT_TEXT = "Suivant";

var imagePath = "images/";
var imageArray = new Array("europa_settings.png", "middleeast_settings.png", "eastandindia_settings.png", "russiaandasia_settings.png", "southeastasia_settings.png", "australia_settings.png", "northamerica_settings.png", "centralamerica_settings.png", "southamerica_settings.png", "africa_settings.png");
var imageIndex = 0;

var mySetting = new clockSettings();
////////////////////////////////////////////////////////////////////////////////
//
// load clock settings
//
////////////////////////////////////////////////////////////////////////////////
function loadSettings()
{
    var pageDir = document.getElementsByTagName("html")[0].dir;
    
    if (pageDir == "rtl")
    {
        settingsButtonTable.dir = "rtl";
        
        var temp = settingsButtonLeftCell.innerHTML;
        settingsButtonLeftCell.innerHTML = settingsButtonRightCell.innerHTML;
        settingsButtonRightCell.innerHTML = temp;
        
        temp = settingsImageLeft.onmousedown;
        settingsImageLeft.onmousedown = settingsImageRight.onmousedown;
        settingsImageRight.onmousedown = temp;
        
        temp = settingsLeftAnchor.onkeypress;
        settingsLeftAnchor.onkeypress = settingsRightAnchor.onkeypress;
        settingsRightAnchor.onkeypress = temp;

        settingsImageLeft.alt = L_NEXT_TEXT;
        settingsImageRight.alt = L_PREVIOUS_TEXT;
    }
    else
    {
        settingsImageLeft.alt = L_PREVIOUS_TEXT;
        settingsImageRight.alt = L_NEXT_TEXT;
    }
    
    mySetting.load();
    loadTimeZones();

    imageIndex = mySetting.themeID;
    
    settingsUpdateIndex();

    clockProperties.innerHTML = L_CONTROLPANEL_TEXT;
    
    clockName.value = mySetting.clockName;
    
    with (timeZoneIndex)
    {
        value = getValidTimeZone(mySetting.timeZoneIndex);
        title = options[selectedIndex].text;
    }
    
    secondsEnabled.checked = mySetting.secondsEnabled;

    System.Gadget.onSettingsClosing = settingsClosing;
}
////////////////////////////////////////////////////////////////////////////////
//
//
////////////////////////////////////////////////////////////////////////////////
function settingsUpdateImage(img, state)
{
    img.src = imagePath + "settings_" + img.src.split("_")[1] + "_" + state + ".png";
}
////////////////////////////////////////////////////////////////////////////////
//
//
////////////////////////////////////////////////////////////////////////////////
function settingsButtonBack()
{
    if (event.keyCode == 32 || event.button == 1)
    {
        imageIndex--;
        
        if (imageIndex < 0)
        {
            imageIndex = imageArray.length - 1;
        }
        
        settingsUpdateIndex();
    }
}
////////////////////////////////////////////////////////////////////////////////
//
//
////////////////////////////////////////////////////////////////////////////////
function settingsButtonForward()
{
    if (event.keyCode == 32 || event.button == 1)
    {
        imageIndex++;
        
        if (imageIndex == imageArray.length)
        {
            imageIndex = 0;
        }
        
        settingsUpdateIndex();
    }
}
////////////////////////////////////////////////////////////////////////////////
//
//
////////////////////////////////////////////////////////////////////////////////
function settingsUpdateIndex()
{
    mySetting.themeID = imageIndex;
    
    settingsImagePreview.src = imagePath + imageArray[imageIndex];
    currentIndex.innerHTML = imageIndex + 1;
    maxIndex.innerHTML = imageArray.length;
}
////////////////////////////////////////////////////////////////////////////////
//
// settings event closing
//
////////////////////////////////////////////////////////////////////////////////
function settingsClosing(event)
{
    if (event.closeAction == event.Action.commit)
    {
        saveSettings();
    }
}
////////////////////////////////////////////////////////////////////////////////
//
// create clock object
//
////////////////////////////////////////////////////////////////////////////////
function clockSettings()
{   
    this.save = saveSettingToDisk;
    this.load = loadSettingFromDisk;
    
    this.themeID = 0;
    this.clockName = "";
    this.timeZoneIndex = -1;
    this.secondsEnabled = false;
}
////////////////////////////////////////////////////////////////////////////////
//
// load the information from disk
//
////////////////////////////////////////////////////////////////////////////////
function loadSettingFromDisk()
{
    if (System.Gadget.Settings.read("SettingsExist"))
    {
        this.clockName = unescape(System.Gadget.Settings.readString("clockName"));
        this.themeID = getValidThemeID(System.Gadget.Settings.read("themeID"));
        this.timeZoneIndex = parseInt(System.Gadget.Settings.read("timeZoneIndex"));
        this.secondsEnabled = System.Gadget.Settings.read("secondsEnabled");
    }
}
////////////////////////////////////////////////////////////////////////////////
//
// save information to disk
//
////////////////////////////////////////////////////////////////////////////////
function saveSettingToDisk()
{
    System.Gadget.Settings.write("SettingsExist", true);
    System.Gadget.Settings.writeString("clockName", escape(this.clockName));
    System.Gadget.Settings.write("themeID", this.themeID);
    System.Gadget.Settings.write("timeZoneIndex", this.timeZoneIndex);
    System.Gadget.Settings.write("secondsEnabled", this.secondsEnabled);
}
////////////////////////////////////////////////////////////////////////////////
//
// save clock settings
//
////////////////////////////////////////////////////////////////////////////////
function saveSettings()
{
    mySetting.clockName = trim(clockName.value, "both");
    mySetting.timeZoneIndex = getValidTimeZone(timeZoneIndex.value);
    mySetting.secondsEnabled = secondsEnabled.checked;

    mySetting.save();
}
///////////////////////////////////////////////////////////////////////////////
//
// load time zones
//
////////////////////////////////////////////////////////////////////////////////
function loadTimeZones()
{
    updateTimeZones(true);   

    timeZoneIndex.options[0] = new Option(L_SELECT_TZ_TEXT, "-1");

    for (var i = 0; i < e.length; i++)
    {
        timeZoneIndex.options[i + 1] = new Option(e[i][eZone], e[i][eItem], null, (e[i][eItem] == mySetting.timeZoneIndex));
        timeZoneIndex.options[i + 1].title = e[i][eZone];
    }
}
////////////////////////////////////////////////////////////////////////////////
//
// open system time date control panel
//
////////////////////////////////////////////////////////////////////////////////
function openSettings()
{
    System.Shell.execute("timedate.cpl");
}
////////////////////////////////////////////////////////////////////////////////
//
// trim white space
//
////////////////////////////////////////////////////////////////////////////////
function trim(stringIn, removeFrom) 
{ 
    var stringOut = "";
    stringIn = stringIn.toString();
    
    if (stringIn.length > 0)
    {
        switch (removeFrom) 
        { 
            case "left": 
                stringOut = stringIn.replace(/^\s+/g, ""); 
                break; 
            case "right": 
                stringOut = stringIn.replace(/\s+$/g, ""); 
                break; 
            case "both":

            default:
                stringOut = stringIn.replace(/^\s+|\s+$/g, ""); 
        }
    }

    return stringOut;
}
////////////////////////////////////////////////////////////////////////////////
//
// check to see if theme index within array
//
////////////////////////////////////////////////////////////////////////////////
function getValidThemeID(index)
{
    if (parseInt(index) > -1 && parseInt(index) < clockThemes.length)
    {
        return parseInt(index);
    }
    else
    {
        return 0;
    }
}
