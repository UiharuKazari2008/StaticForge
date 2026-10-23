System.Gadget.onSettingsClosing = settingsClosing;

var soundSetting;
var soundSettings = Array('- None -', 'Click', 'Bass Drum', 'Snare', 'Disco');
var sounds = Array('', 'click.wav', 'bassDrum.wav', 'snare.wav', 'disco.wav');

var populating = false;

loadSetting();

function populateSoundDropdown() {
	
	populating = true;

	for (i = 0; i < soundSettings.length; i++) {
		soundSelect.options[i] = new Option(soundSettings[i], i);

		if (i == soundSetting)
			soundSelect.options.selectedIndex = soundSetting;
	}

	populating = false;
}

function playSelectedSound() {
	System.Sound.playSound('sounds/'+sounds[soundSelect.options.selectedIndex]);
}

function changeSound() {

	if (!populating)
			playSelectedSound();

	setSound(soundSelect.options.selectedIndex);
}

function setSound(soundValue) {

	soundSetting = soundValue;
}

function loadSetting() {
    var settingExist = System.Gadget.Settings.read("settingExist");	

	if (settingExist)
	{
		setSound(System.Gadget.Settings.read("soundSetting"));
	} 
	else 
	{
		soundSetting = 1;
	}
}

function saveSettings()
{
    System.Gadget.Settings.write("soundSetting", soundSetting);
    System.Gadget.Settings.write("SettingExist", true);
}


function settingsClosing(event)
{
    if (event.closeAction == event.Action.commit)
    {
        saveSettings();
		currentSound = soundSetting;
    }
    else if (event.closeAction == event.Action.cancel)
    {
    }

    event.cancel = false;
}