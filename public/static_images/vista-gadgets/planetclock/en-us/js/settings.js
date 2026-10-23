var L_SELECT_TZ_TEXT = "Current computer time";
var L_CONTROLPANEL_TEXT = "Computer date and time";

var L_PREVIOUS_TEXT = "Previous";
var L_NEXT_TEXT = "Next";

var imagePath = "images/";
var imageArray = new Array("system_settings.png", "earth_settings.png", "mercury_settings.png", "venus_settings.png", "moon_settings.png", "mars_settings.png", "jupiter_settings.png", "calisto_settings.png", "ganymede_settings.png", "io_settings.png", "saturn_settings.png", "uranus_settings.png", "neptune_settings.png", "pluto_settings.png");
var imageIndex = 0;

var mySetting = new clockSettings();

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
    secondsEnabledDigital.checked = mySetting.secondsEnabledDigital;

    show24.checked = mySetting.show24;

    System.Gadget.onSettingsClosing = settingsClosing;
}

function settingsUpdateImage(img, state)
{
    img.src = imagePath + "settings_" + img.src.split("_")[1] + "_" + state + ".png";
}

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

function settingsUpdateIndex()
{
    mySetting.themeID = imageIndex;
    
    settingsImagePreview.src = imagePath + imageArray[imageIndex];
    currentIndex.innerHTML = imageIndex + 1;
    maxIndex.innerHTML = imageArray.length;
}

function settingsClosing(event)
{
    if (event.closeAction == event.Action.commit)
    {
        saveSettings();
    }
}

function clockSettings()
{   
    this.save = saveSettingToDisk;
    this.load = loadSettingFromDisk;
    
    this.themeID = 0;
    this.clockName = "";
    this.timeZoneIndex = -1;
    this.secondsEnabled = false;
    this.secondsEnabledDigital = false;
    this.show24 = false;
}

function loadSettingFromDisk()
{
    if (System.Gadget.Settings.read("SettingsExist"))
    {
        this.clockName = unescape(System.Gadget.Settings.readString("clockName"));
        this.themeID = getValidThemeID(System.Gadget.Settings.read("themeID"));
        this.timeZoneIndex = parseInt(System.Gadget.Settings.read("timeZoneIndex"));
        this.secondsEnabled = System.Gadget.Settings.read("secondsEnabled");
        this.secondsEnabledDigital = System.Gadget.Settings.read("secondsEnabledDigital");
        this.show24 = System.Gadget.Settings.read("show24");
    }
}

function saveSettingToDisk()
{
    System.Gadget.Settings.write("SettingsExist", true);
    System.Gadget.Settings.writeString("clockName", escape(this.clockName));
    System.Gadget.Settings.write("themeID", this.themeID);
    System.Gadget.Settings.write("timeZoneIndex", this.timeZoneIndex);
    System.Gadget.Settings.write("secondsEnabled", this.secondsEnabled);
    System.Gadget.Settings.write("secondsEnabledDigital", this.secondsEnabledDigital);
    System.Gadget.Settings.write("show24", this.show24);
}

function saveSettings()
{
    mySetting.clockName = trim(clockName.value, "both");
    mySetting.timeZoneIndex = getValidTimeZone(timeZoneIndex.value);
    mySetting.secondsEnabled = secondsEnabled.checked;
    mySetting.secondsEnabledDigital = secondsEnabledDigital.checked;
    mySetting.show24 = show24.checked;

    mySetting.save();
}

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

function openSettings()
{
    System.Shell.execute("timedate.cpl");
}

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
