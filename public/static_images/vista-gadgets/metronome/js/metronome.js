// Environment Variables
var sizeMode;
var sounds = Array('', 'click.wav', 'bassDrum.wav', 'snare.wav', '#disco');
var disco = Array('bassDrum.wav', 'hihat.wav', 'snare.wav', 'hihat.wav');
var currentSound = 4;
var discoCount = 0;

var blinkerOn = "images/light_beat_on.png";
var blinkerOff = "images/light_beat.png";

var playInterval;
var playing = false;
var muted = false;

var incrementInterval;
var incrementSpeed = 10;
var incrementDelay = 300;
var incrementing = false;

var tempo = 120;
var maxTempo = 1000;
var minTempo = 1;

var blinkDuration = 100;	// blink 'on' state should appear for this many milliseconds


loadSetting();
currentSound = soundSetting;

function checkState() {
	if (System.Gadget.docked) 
		dockedState();
	else
		undockedState(); 
}

function undockedState() {
	sizeMode = 'large';
}

function dockedState() {
	sizeMode = 'small';
}


function gadgetLoad() {

	checkState();

	loadSettings();
	
	System.Gadget.onSettingsClosed = SettingsClosed;

	playSong(loadSong, loadTempo);
}

function SettingsClosed(event) {

    if (event.closeAction == event.Action.commit)
		loadSettings();

	mute();
}

function ShowSettings() {
	mute();
}


function loadSettings() {

	// load the tempo setting
	if (System.Gadget.Settings.read("tempo"))
		tempoSetting = System.Gadget.Settings.read("tempo");
	else
		tempoSetting = 120;

	// load the clicktrack sound
	if (System.Gadget.Settings.read("settingExist"))
		soundSetting = System.Gadget.Settings.read("soundSetting");
	else
		soundSetting = 1;

	setSound(soundSetting);
}


function setSound(value) {
	currentSound = value;
}

function swapImage(img, src) {
	img.src = 'images/'+src;
}

function incrementTempo() {
	setTempo(Math.min(maxTempo, tempo+1));
}

function decrementTempo() {
	setTempo(Math.max(minTempo, tempo-1));
}

function setTempo(value) {
	tempo = value;

	tempoShadow.innerHTML = 
	tempoHueValue.innerHTML = tempo;

	if (playing)
		play();
}

function blink() {
	blinker.src = blinkerOn;
	setTimeout(unBlink, blinkDuration);
}

function unBlink() {
	blinker.src = blinkerOff;
}


// Delay before incrementing
function incrementLoop() {
	clearInterval(incrementInterval);	
	incrementInterval = setInterval(beginIncrementLoop, incrementDelay);

	incrementing = true;
}

// incrementing loop
function beginIncrementLoop() {
	clearInterval(incrementInterval);	
	incrementInterval = setInterval(incrementTempo, incrementSpeed);
}

// Delay before decrementing
function decrementLoop() {
	clearInterval(incrementInterval);	
	incrementInterval = setInterval(beginDecrementLoop, incrementDelay);

	incrementing = true;
}

// decrementing loop
function beginDecrementLoop() {
	clearInterval(incrementInterval);	
	incrementInterval = setInterval(decrementTempo, incrementSpeed);
}

// stops all decrementing
function stopLoop() {
	clearInterval(incrementInterval);

	incrementing = false;
}


function play() {
	// convert the tempo (beats per minute) to millisecond intervals
	var tempoMS = 60000/tempo;	// 60 000 ms in one minute, divide by bpm

	clearInterval(playInterval);
	playInterval = setInterval(playLoop, tempoMS);

	if (!incrementing)
		playLoop();

	playing = true;
}

function stop() {
	clearInterval(playInterval);
	blinker.src = blinkerOff;

	discoCount = 0;

	playing = false;
}

function mute() {
	if (muted)
		muted = false;
	else
		muted = true;
}

function playLoop() {
	blink();
	playSound();
} 

function playSound() {

	if (sounds[currentSound] == '')
		return(false);	

	if (sounds[currentSound].charAt(0) == '#') {

		toPlay = 'sounds/'+disco[discoCount++%disco.length];

	} else {
		toPlay = 'sounds/'+sounds[currentSound];
	}

	if (!muted)
		System.Sound.playSound(toPlay);
}


function starterMouseOver() {
	swapImage(starter, 'button_starter_hover.png');
}

function starterMouseOut() {
	swapImage(starter, 'button_starter.png');
}

function starterMouseDown() {
	swapImage(starter, 'button_starter_press.png');
}

function starterMouseUp() {
	swapImage(starter, 'button_starter_hover.png'); 

	if (playing)
		stop();
	else 
		play();
}


function keyUp() {

	// stop/play if spacebar or return are pressed.
	if (event.keyCode == 32 || event.keyCode == 13) {
		 if (playing)
			stop();
		else
			play();
	} else if (event.keyCode == 38 || event.keyCode == 40) {
		// stop iterating when up/down is released
		stopLoop();
	}
}

function keyDown() {

	if (event.keyCode == 38) {
		// iterate up if up is pressed.
		incrementLoop(); 
		incrementTempo();
	} 
	else if (event.keyCode == 40)
	{
		// iterate down if up is pressed.
		decrementLoop(); 
		decrementTempo();
	}
}