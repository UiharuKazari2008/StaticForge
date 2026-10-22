System.Gadget.settingsUI = "Settings.html";

//----------------------------------------
// SOHO
//----------------------------------------

var gSOHO;
var gDetectors = Array("eit_171", "eit_195", "eit_284", "eit_304", "mdi_igr", "mdi_mag", "c2", "c3");
var gCurrentImages = Array();

function SOHO() {
    this.ImageURLFormat = "http://sohowww.nascom.nasa.gov/data/realtime/DETECTOR/SIZE/latest.jpg";
    this.MovieURLFormat = "http://sohowww.nascom.nasa.gov/data/LATEST/current_DETECTOR.mpg";
	this.Detector = System.Gadget.Settings.read("Detector");
	if (!this.Detector) {
		this.Detector = "eit_304";
		System.Gadget.Settings.write("Detector", this.Detector);
	}
	this.GetImageURL = function(pDetector, pCompletionFunc) {
	    if (pDetector == "*") {
	        for (var vIndex = 0; vIndex < gDetectors.length; ++vIndex)
    	        pCompletionFunc(200, this.ImageURLFormat.replace("DETECTOR", gDetectors[vIndex]).replace("SIZE", "512"));
    	    return;
	    }
	    if (!pDetector) pDetector = this.Detector;
	    pCompletionFunc(200, this.ImageURLFormat.replace("DETECTOR", pDetector).replace("SIZE", "512"));
	}
	this.SetDetector = function(pDetector) {
		this.Detector = pDetector;
		System.Gadget.Settings.write("Detector", pDetector);
	}
}

//----------------------------------------
// FullSun
//----------------------------------------

var	gCurrentImageURL;

function FullSun_SetImageURL(pStatus, pURL) {
    System.Debug.outputString("FullSun_SetImageURL(" + pStatus + ", " + pURL);
	if (pStatus != 200) return;
	
	if (pURL != gCurrentImageURL) {
		gCurrentImageURL = pURL;
		SunImage.src = pURL;
		FullSun_ShowSidebarMovie(System.Gadget.Settings.read("showMovie"), System.Gadget.Settings.read("movieSpeed"));
	}
}
function FullSun_ShowSidebarMovie(pShow, pSpeed) {
	if (pShow) {
		var vURL = gSOHO.MovieURLFormat.replace("DETECTOR", System.Gadget.Settings.read("Detector"));
		SunMovie.style.display = "inline";
		if (vURL != SunMovie.url) SunMovie.url = vURL;
		
		if (pSpeed > 0) SunMovie.settings.rate = pSpeed;
		else SunMovie.settings.rate = 1;
	}
	else SunMovie.style.display = "none";
}

function FullSun_Update() {
	gSOHO.Detector = System.Gadget.Settings.read("Detector");
	gSOHO.GetImageURL(gSOHO.Detector, FullSun_SetImageURL);
}

function FullSun_OnLoad() {
	System.Gadget.onSettingsClosed = FullSun_SettingsChanged;
	
	gSOHO = new SOHO();
	gSOHO.GetImageURL(null, FullSun_SetImageURL);
	
	setInterval("FullSun_Update()", 2 * 60 * 60 * 1000); // Update every two hours

	FullSun_ShowSidebarMovie(System.Gadget.Settings.read("showMovie"), System.Gadget.Settings.read("movieSpeed"));
}

function FullSun_ShowPicker() {
	if (System.Gadget.Flyout.show)
		System.Gadget.Flyout.show = false;
	else {
		System.Gadget.Flyout.onHide = FullSun_Update;
		System.Gadget.Flyout.file = "Picker.html";
		System.Gadget.Flyout.show = true;
	}
}

function FullSun_SettingsChanged(pEvent) {
    if (pEvent.closeAction != pEvent.Action.commit)
		return;
	
	FullSun_ShowSidebarMovie(
			System.Gadget.Settings.read("showMovie"),
			System.Gadget.Settings.read("movieSpeed"));
}

//----------------------------------------
// Detector browser
//----------------------------------------

function Picker_Initialize() {
	gSOHO = new SOHO();
	gSOHO.GetImageURL("*", Picker_SetImageURL);
	Picker_HighlightDetector(System.Gadget.Settings.read("Detector"));
}

function Picker_SetImageURL(pStatus, pURL) {
	for (var vIndex = 0; vIndex < gDetectors.length; ++vIndex) {
		var	vDetector = gDetectors[vIndex];
		
		if (pURL.search(vDetector) >= 0) {
			var	vImage = document.getElementById(vDetector);
			gCurrentImages[vDetector] = pURL;
			vImage.src = pURL;
			document.getElementById("pickerLargeView").src = pURL;
			break;
		}
	}
	
	Picker_SetLargeImage(System.Gadget.Settings.read("Detector"));
}

function Picker_HighlightDetector(pDetector) {
	for (var vIndex = 0; vIndex < gDetectors.length; ++vIndex) {
		var	vDetector = gDetectors[vIndex];
		var	vAnchor = document.getElementById("a_" + vDetector);
		
		if (pDetector == vDetector) 	vAnchor.className = "SelectedDetector";
		else vAnchor.className = "";
	}
	
	var	vMovie = document.getElementById("pickerMovie");
	
	if (vMovie.style.display != "none")
		vMovie.url = gSOHO.MovieURLFormat.replace("DETECTOR", pDetector);
}

function Picker_SetLargeImage(pDetector) {
	document.getElementById("pickerLargeView").src = gCurrentImages[pDetector];
	document.getElementById("pickerLargeURL").href = gCurrentImages[pDetector];
	
	document.getElementById("eit_171_desc").setAttribute("display", "none");
	
	for (var vIndex = 0; vIndex < gDetectors.length; ++vIndex) {
		var	vDetector = gDetectors[vIndex];
		document.getElementById(vDetector + "_desc").style.display = pDetector == vDetector? "inline" : "none";
	}
}

function Picker_SetDetector(pDetector) {
	gSOHO.SetDetector(pDetector);
	Picker_HighlightDetector(pDetector);
	Picker_SetLargeImage(pDetector);
	// System.Gadget.Flyout.show = false;
}

function Picker_ToggleMovie() {
	Picker_ShowMovie(document.getElementById("pickerLargeView").style.display != "none");
}

function Picker_ShowMovie(pShow) {
	var	vImage = document.getElementById("pickerLargeView");
	var	vMovie = document.getElementById("pickerMovie");
	var	vDescription = document.getElementById("pickerDescription");
	
	if (pShow) {
		vImage.style.display = "none";
		vDescription.style.display = "none";
		vMovie.style.display = "block";
		
		var url = gSOHO.MovieURLFormat.replace("DETECTOR", System.Gadget.Settings.read("Detector"));
		vMovie.url = url;
	} else {
		vImage.style.display = "inline";
		vDescription.style.display = "block";
		vMovie.style.display = "none";
		vMovie.url = "";
	}
}

//----------------------------------------
// Settings dialog
//----------------------------------------

function Settings_OnLoad() {
	System.Gadget.onSettingsClosing = Settings_OnClose;
	
	Settings_SetRadioValue(Radio_Display, System.Gadget.Settings.read("showMovie")? "movie" : "image");
	
	var vSpeed = System.Gadget.Settings.read("movieSpeed");
	if (!vSpeed) vSpeed = 1;
	
	Settings_SetRadioValue(Radio_Speed, vSpeed);
}

function Settings_OnClose(pEvent) {
	if (pEvent.closeAction != pEvent.Action.commit) return;
	
	System.Gadget.Settings.write("showMovie", Settings_GetRadioValue(Radio_Display) == "movie");
	System.Gadget.Settings.write("movieSpeed", Settings_GetRadioValue(Radio_Speed));
}

function Settings_GetRadioValue(pRadioGroup) {
	for (vIndex = 0; vIndex < pRadioGroup.length; ++vIndex) {
		if (pRadioGroup[vIndex].checked)
			return pRadioGroup[vIndex].value;
	}
}

function Settings_SetRadioValue(pRadioGroup, pValue) {
	for (vIndex = 0; vIndex < pRadioGroup.length; ++vIndex)
		pRadioGroup[vIndex].checked = pRadioGroup[vIndex].value == pValue;
}

