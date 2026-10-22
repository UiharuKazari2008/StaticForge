var timer;
var rotate = 0;
var speedblur = 1;
var canvas, im;

var image = "YinYang.png";

System.Gadget.settingsUI = "settings.htm";
System.Gadget.onSettingsClosed = loadSettings;

function init()
{
	canvas = document.getElementById("canvas");
	canvas.removeObjects();
	
	var setting = System.Gadget.Settings.read("image")
	
	if (setting != "")
		image = setting;
	im = canvas.addImageObject(image, 5, 10);
	im.Opacity = 50;
	spin();
}

function spin()
{
	clearTimeout(timer);
	rotate += speedblur;
	im.Rotation = rotate;
	im.blur = (speedblur-1)/6;
	if (speedblur > 1) // not mathematically needed
	{
		speedblur /= 1.011;
	}
	timer = setTimeout("spin()", 100);
}

function speed()
{
	speedblur += 10;
}

function loadSettings()
{
	image = System.Gadget.Settings.read("image");
	if (image != "")
		init();
}