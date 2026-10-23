// Environment Variables
var loopOn = false;
var loopInterval = 0;
var sizeMode = 'small';	// large or small

var octaveDown = false;

var sounds = Array('sound_C','sound_D','sound_E','sound_F','sound_G','sound_A','sound_B','sound_C_high','sound_Cs','sound_Eb','sound_Fs','sound_Ab','sound_Bb');
var currentNote = '';

// sound types for keyboard
var soundModes = Array('piano', 'square');
var soundIndex = 0;
var currentSound = soundModes[soundIndex];

// demo song
var loadSong = "0";
var loadTempo = 300;
var demoSong = "2 3 4 5 6 4 6 - s3 3 s3 - 5 s1 5 - 2 3 4 5 6 4 6 9 8 6 4 6 8";
var demoTempo = 120;

// Small keys
var whiteKeySmall = "images/button_whitekey.png";
var whiteKeySmallHover = "images/button_whitekey_hover.png";
var whiteKeySmallPress = "images/button_whitekey_press.png";

var blackKeySmall = "images/button_blackkey.png";
var blackKeySmallHover = "images/button_blackkey_hover.png";
var blackKeySmallPress = "images/button_blackkey_press.png";

// Large keys
var whiteKeyLarge = "images/button_whitekeylarge.png";
var whiteKeyLargeHover = "images/button_whitekeylarge_hover.png";
var whiteKeyLargePress = "images/button_whitekeylarge_press.png";

var blackKeyLarge = "images/button_blackkeylarge.png";
var blackKeyLargeHover = "images/button_blackkeylarge_hover.png";
var blackKeyLargePress = "images/button_blackkeylarge_press.png";

// last key pressed.  Tracking this prevents the hoverstate from staying active on mouseout
var lastKey = this.smallWhiteKey_15;
var lastKeyType = 'white';


function playNote(note) {

	if (note != undefined && note != '-' )
		System.Sound.playSound('sounds/'+currentSound+'/'+note+'.wav');
}

function playSemitone(note) {

	if (note != undefined && note != '-')
		System.Sound.playSound('sounds/'+currentSound+'/s'+note+'.wav');
}


function checkState()
{
	if (System.Gadget.docked) 
	{
		dockedState();
	} 
	else
	{
		undockedState(); 
	}
}

// this draws the keys in small mode
function buildSmallKeys() {

	var smallKeysHTML = '';

	// draw the white keys
	for (i = 15; i < 23; i++)
	{
		var id = 'smallWhiteKey_'+i;
		var src = 'images/button_whitekey.png';
		var mouseOver = "javascript:whiteKeyHover(this);";
		var mouseOut = "javascript:whiteKeyRest(this);";
		var mouseDown = "javascript:whiteKeyPress(this, "+i+");";
		var mouseUp = "javascript:whiteKeyHover(this);";

		var keyDefinition = '<img id="'+id+'" src="'+src+'" onMouseOver="'+mouseOver+'" onMouseOut="'+mouseOut+'" onMouseDown="'+mouseDown+'" onMouseUp="'+mouseUp+'"/>';

		smallKeysHTML += keyDefinition;
	}

	
	// draw the black keys
	var xOffsets = Array('8', '22', '50', '64', '78');

	j = 0;
	for (i = 10; i < 15; i++)
	{
		var id = 'smallBlackKey_'+i;
		var src = 'images/button_blackkey.png';
		var keyStyle = "position: absolute; left: "+xOffsets[j]+"px;";
		var mouseOver = "javascript:blackKeyHover(this);";
		var mouseOut = "javascript:blackKeyRest(this);";
		var mouseDown = "javascript:blackKeyPress(this, "+i+");";
		var mouseUp = "javascript:blackKeyHover(this);";

		var keyDefinition = '<img id="'+id+'" src="'+src+'" style="'+keyStyle+'" onMouseOver="'+mouseOver+'" onMouseOut="'+mouseOut+'" onMouseDown="'+mouseDown+'" onMouseUp="'+mouseUp+'"/>';

		smallKeysHTML += keyDefinition + ' ';

		j++;
	}

	keys_small.innerHTML = smallKeysHTML;
}


// this draws the keys in large mode
function buildLargeKeys() {

	largeKeysHTML = '';

	// draw the white keys
	for (i = 0; i < 30; i++)
	{
		var id = 'largeWhiteKey_'+i;
		var src = 'images/button_whitekeylarge.png';
		var mouseOver = "javascript:whiteKeyHover(this);";
		var mouseOut = "javascript:whiteKeyRest(this);";
		var mouseDown = "javascript:whiteKeyPress(this, "+i+");";
		var mouseUp = "javascript:whiteKeyHover(this);";

		var keyDefinition = '<img id="'+id+'" src="'+src+'" onMouseOver="'+mouseOver+'" onMouseOut="'+mouseOut+'" onMouseDown="'+mouseDown+'" onMouseUp="'+mouseUp+'"/>';

		largeKeysHTML += keyDefinition;
	}


	// build the black keys
	// x offsets for black keys
	var xOffsets = Array(38, 70, 116, 145, 175, 220, 252, 298, 327, 357, 402, 434, 480, 509, 539, 584, 616, 662, 691, 721);

	// draw the black keys
	for (i = 0; i < 20; i++)
	{
		var id = 'largeBlackKey_'+i;
		var src = 'images/button_blackkeylarge.png';
		var keyStyle = "position: absolute; left: "+xOffsets[i]+"px;";
		var mouseOver = "javascript:blackKeyHover(this);";
		var mouseOut = "javascript:blackKeyRest(this);";
		var mouseDown = "javascript:blackKeyPress(this, "+i+");";
		var mouseUp = "javascript:blackKeyHover(this);";

		var keyDefinition = '<img id="'+id+'" src="'+src+'" style="'+keyStyle+'" onMouseOver="'+mouseOver+'" onMouseOut="'+mouseOut+'" onMouseDown="'+mouseDown+'" onMouseUp="'+mouseUp+'" border="0"/>';

		largeKeysHTML += keyDefinition;
	}

	keys_large.innerHTML = largeKeysHTML;
}


// this is called to set variables and draw the piano in its undocked state (large)
function undockedState()
{
	smallPiano.style.visibility = 'hidden';
	largePiano.style.visibility = 'visible';

	clearKeys();
	buildLargeKeys();

	// resize the gadget and reset the background
	piano.style.width = 852;
    piano.style.height = 198;
	piano.style.background = "url(../images/bg_large.png)";

	sizeMode = 'large';
}

// this is called to set variables and draw the piano in its docked state (small)
function dockedState() 
{
	smallPiano.style.visibility = 'visible';
	largePiano.style.visibility = 'hidden';

	// resize the gadget and reset the background
	piano.style.width = 129;
    piano.style.height = 113;
	piano.style.background = "url(../images/bg_small.png)";

	clearKeys();
	buildSmallKeys();

	sizeMode = 'small';
}

function clearKeys() {
}

function gadgetLoad()
{
	checkState();

	loadSettings();
	
	System.Gadget.onSettingsClosed = SettingsClosed;

	playSong(loadSong, loadTempo);
}

function SettingsClosed(event)
{
    if (event.closeAction == event.Action.commit)
    {        
		loadSettings();
    }
}


function loadSettings() {

	if (System.Gadget.Settings.read("settingExist"))
	{
		skinSetting = System.Gadget.Settings.read("skinSetting");
		setPianoSkin(skinSetting);
	}
	else 
	{
		skin_small.style.backgroundColor = "#000000";
		skin_large.style.backgroundColor = "#000000";
	}	
}

function setPianoSkin(skinValue)
{
	if (skinValue.charAt(0) == '#')
	{
		// skin is a color
		skin_small.style.background = 
		skin_large.style.background = "none";

		skin_small.style.backgroundColor = 
		skin_large.style.backgroundColor = skinValue;
	}
	else
	{
		// skin is an image
		skin_small.style.background = 
		skin_large.style.background = "url(../images/"+skinValue+")";
	}
}


function whiteKeyHover(image) {

	// ensure the previously pressed key is set to its rest state
	if (image != lastKey)
	{
		if (lastKey.id.indexOf('ack') != -1)
			blackKeyRest(lastKey);
		else 
			whiteKeyRest(lastKey);
	}

	if (sizeMode == 'small')
		image.src = whiteKeySmallHover;
	else
		image.src = whiteKeyLargeHover;

	lastKey = image;
	lastKeyType = 'white';
}

function whiteKeyRest(image) {
	if (sizeMode == 'small')
		image.src = whiteKeySmall;
	else
		image.src = whiteKeyLarge;
}

function whiteKeyPress(image, note) {
	if (sizeMode == 'small')
		image.src = whiteKeySmallPress;
	else
		image.src = whiteKeyLargePress;

	playNote(note);

	lastKey = image;
	lastKeyType = 'white';
}

function whiteKeyboardPress(note) {
	if (sizeMode == 'small') {
		this['smallWhiteKey_'+note].src = whiteKeySmallPress;
		lastKey = this['smallWhiteKey_'+note];
	} else {
		this['largeWhiteKey_'+note].src = whiteKeyLargePress;
		lastKey = this['largeWhiteKey_'+note];
	}

	playNote(note);

	lastKeyType = 'white';
}

function blackKeyHover(image) {

	// ensure the previously pressed key is set to its rest state
	if (image != lastKey)
	{
		if (lastKey.id.indexOf('ack') != -1)
			blackKeyRest(lastKey);
		else 
			whiteKeyRest(lastKey);
	}

	if (sizeMode == 'small')
		image.src = blackKeySmallHover;
	else
		image.src = blackKeyLargeHover;

	lastKey = image;
	lastKeyType = 'black';
}

function blackKeyRest(image) {
	if (sizeMode == 'small')
		image.src = blackKeySmall;
	else
		image.src = blackKeyLarge;
}

function blackKeyPress(image, note) {
	if (sizeMode == 'small')
		image.src = blackKeySmallPress;
	else
		image.src = blackKeyLargePress;

	playSemitone(note);

	lastKey = image;
	lastKeyType = 'white';
}

function blackKeyboardPress(note) {
	if (sizeMode == 'small') {
		this['smallBlackKey_'+note].src = blackKeySmallPress;
		lastKey = this['smallBlackKey_'+note];
	} else {
		this['largeBlackKey_'+note].src = blackKeyLargePress;
		lastKey = this['largeBlackKey_'+note];
	}

	playSemitone(note);

	lastKeyType = 'black';
}

// calling this will switch through the available sound types
function switchSoundMode(mode) {

	if (mode == undefined)
		soundIndex = (soundIndex + 1) % soundModes.length;
	else
		soundIndex = mode;

	currentSound = soundModes[soundIndex];
	// update the small piano button
	img = document.images['button_sound'].src = "images/button_mode_"+currentSound+".png";

	
	// update the large piano mode buttons

	// save the settings
	System.Gadget.Settings.write("soundIndex", soundIndex);
}

function pressMode(image) {
	image.src = "images/button_mode_"+currentSound+"_press.png";
}

function releaseMode(image) {
	image.src = "images/button_mode_"+currentSound+".png";
}


function keyDown() {
	// use the keyboard to play notes here (keyinput is set on the body tag to capture key events)
	// holding spacebar or shift will lower the notes by an octave

	var toPlay = -1;
	var semitone = false;

	switch(event.keyCode) {
		case 97:
		case 65:	// c
			toPlay = 15;
			break;
		case 98:
		case 83:	// d
			toPlay = 16;
			break;
		case 99:
		case 68:	// e
			toPlay = 17;
			break;
		case 100:
		case 70:	// f
			toPlay = 18;
			break;
		case 101:
		case 71:	// g
			toPlay = 19;
			break;
		case 102:
		case 72:	// a
			toPlay = 20;
			break;
		case 103:
		case 74:	// b
			toPlay = 21;
			break;
		case 104:
		case 75:	// c
			toPlay = 22;
			break;

		// Semitones
		case 87:	// C#
			toPlay = 10;
			semitone = true;
			break;
		case 69:	// Eb
			toPlay = 11;
			semitone = true;
			break;
		case 84:	// F#
			toPlay = 12;
			semitone = true;
			break;
		case 89:	// Ab
			toPlay = 13;
			semitone = true;
			break;
		case 85:	// Bb
			toPlay = 14;
			semitone = true;
			break;
		case 16:
		case 32:
			toggleOctave();
			break;
	}

	if (octaveDown) {
		if (semitone == true)
			toPlay -= 5;
		else
			toPlay -= 7;
	}

	if (toPlay >= 0) {
		if (semitone)
			blackKeyboardPress(toPlay);
		else
			whiteKeyboardPress(toPlay);
	}
}

function keyUp() {

	 if (event.keyCode == 32 || event.keyCode == 16)
		 toggleOctave();

	if (lastKeyType == 'white')
		whiteKeyRest(lastKey);
	else
		blackKeyRest(lastKey);

}

function toggleOctave() {
	if (octaveDown)
		octaveDown = false;
	else
		octaveDown = true;
}