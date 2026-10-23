////////////////////////////////////////////////////////////////////////////////
//
//  THIS CODE IS NOT APPROVED FOR USE IN/ON ANY OTHER UI ELEMENT OR PRODUCT COMPONENT.
//  Copyright (c) 2006 Microsoft Corporation.  All rights reserved.
//
////////////////////////////////////////////////////////////////////////////////

var L_SELECT_TZ_TEXT = "Current computer time";
var L_CONTROLPANEL_TEXT = "Change computer date and time";

var L_PREVIOUS_TEXT = "Previous";
var L_NEXT_TEXT = "Next";

var imagePath = "images/";
var imageArray = new Array("trad_settings.png", "system_settings.png", "modern_settings.png", "square_settings.png");
var imageIndex = 0;

var clockThemes = new Array("trad", "system", "modern", "square");
var clockHighlights = new Array("trad", "system", "spacer", "square");
var posLogo = 25;
var sizeLogo = 80; 

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
    
    clockProperties.innerHTML = L_CONTROLPANEL_TEXT;
    
    clockName.value = mySetting.clockName;
    
    with (timeZoneIndex)
    {
        value = getValidTimeZone(mySetting.timeZoneIndex);
        title = options[selectedIndex].text;
    }
    
    secondsEnabled.checked = mySetting.secondsEnabled;
    digitalEnabled.checked = mySetting.digitalEnabled;
    logoFile.value = mySetting.logoFile;

    settingsUpdateIndex();

    System.Gadget.onSettingsClosing = settingsClosing;
}
////////////////////////////////////////////////////////////////////////////////
//
// set theme images
//
////////////////////////////////////////////////////////////////////////////////
function setSettingImages()
{
    var curTheme = clockThemes[mySetting.themeID];
    
    clockBg.src = "images/" + curTheme + ".png";
    
    highlights.src = "images/" + clockHighlights[mySetting.themeID] + "_highlights.png";
    
    h.src = "images/" + curTheme + "_h.png";
    m.src = "images/" + curTheme + "_m.png";
    s.src = "images/" + curTheme + "_s.png";
    dot.src = "images/" + curTheme + "_dot.png";

    imglogo.src = logoFile.value;

    switch (curTheme)
    {
        case "trad":
	    sizeLogo = 71;
	    posLogo = (130/2) - (sizeLogo/2);
            break;
        case "system":
	    sizeLogo = 73;
            posLogo = (130/2) - (sizeLogo/2);
            break;
        case "modern":
	    sizeLogo = 76;
	    posLogo = (130/2) - (sizeLogo/2);
            break;
        case "square":
	    sizeLogo = 106;
            posLogo = 12;
            break;
    }
    
    with (imglogo.style)
    {
        top = 8 + posLogo + "px";
        left = 74 + posLogo + "px";
	width = sizeLogo + "px";
	height = sizeLogo + "px";
   	if (trim(mySetting.logoFile, "both") == "")
   	{
   	    visibility = "hidden";
   	}
   	else
   	{
   	    visibility = "visible";
   	}    
    }
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
    
    currentIndex.innerHTML = imageIndex + 1;
    maxIndex.innerHTML = imageArray.length;
    setSettingImages();
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
    this.digitalEnabled = false;
    this.logoFile = "logos/Imtech ICT.png";
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
        this.digitalEnabled = System.Gadget.Settings.read("digitalEnabled");
	this.logoFile = System.Gadget.Settings.readString("logoFile");
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
    System.Gadget.Settings.write("digitalEnabled", this.digitalEnabled);
    System.Gadget.Settings.writeString("logoFile", this.logoFile);
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
    mySetting.digitalEnabled = digitalEnabled.checked;
    mySetting.logoFile = trim(logoFile.value, "both");

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
////////////////////////////////////////////////////////////////////////////////
//
// Browse for the logo file
//
////////////////////////////////////////////////////////////////////////////////
function browseFile()
{
    var oItem = System.Shell.chooseFile(true, "Image:*.png;*.jpg;*.gif::", ".", "");
    if (oItem) 
    {
	logoFile.value = oItem.path;
	imglogo.src = logoFile.value;
    }
}
