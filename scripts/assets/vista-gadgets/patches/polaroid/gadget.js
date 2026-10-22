System.Gadget.settingsUI = "Settings.html";
System.Gadget.onSettingsClosed = SettingsClosed;


var supportedFileTypes = " .jpg .png .gif ";
////var bodyImageSurround;
var bodyText;
var sMouseX = 0;

var imageWidth, imageHeight;
var bodyWidth = maxImageWidth + 10;
var bodyHeight = maxImageHeight + 50;
var initialRotation = 0;
var bodyImageSurroundXoffset = 0;
var bodyImageSurroundYoffset = 0;

var imageBorder, textBorder, textFont, textFontSize, textFontColour, image, imageRotation, maxImageWidth, maxImageHeight, blurBorder;
readSettings();

if (String(imageRotation) == "") {
	image="images/blank.jpg";
	imageBorder = 5+6;
	textBorder = 10;
	textFont = "Comic Sans MS";
	textFontSize = 18;
	imageRotation = parseInt((Math.random()*10-5+360) % 360);
	maxImageWidth = 200;
	maxImageHeight = 200;
	caption = "drag/drop image";
	textFontColour = "rgb(0,0,0)";
	blurBorder = 20;
	System.Gadget.Settings.write("textFontColour", textFontColour);
	System.Gadget.Settings.write("imageBorder", imageBorder);
	System.Gadget.Settings.write("textBorder", textBorder);
	System.Gadget.Settings.write("textFont", textFont);
	System.Gadget.Settings.write("textFontSize", textFontSize);
	System.Gadget.Settings.write("Rotation", imageRotation);
	System.Gadget.Settings.write("maxImageWidth", maxImageWidth);
	System.Gadget.Settings.write("maxImageHeight", maxImageHeight);
	System.Gadget.Settings.write("Caption", caption);
	System.Gadget.Settings.write("blurBorder", blurBorder);
}
// (Yozora #629) nothing dropped yet: a picture from the workspace, as the Slide Show shows
if ((!image || image == "images/blank.jpg") && System.Gadget.picture) {
	image = System.Gadget.picture;
	if (!caption || caption == "drag/drop image") caption = System.Gadget.pictureCaption || "";
}



// We've received a file
function fileDragDropped() {
	var i = 0;
	var sFile = "";
	var sFiletype = "";

	try{	
		while(System.Shell.itemFromFileDrop(event.dataTransfer, i).path)
		{
			sFile = String(System.Shell.itemFromFileDrop(event.dataTransfer, i).path);
			sFiletype = " " + sFile.substring(sFile.lastIndexOf(".")) + " ";

			if(supportedFileTypes.indexOf(sFiletype.toLowerCase()) > -1)
			{
				caption = sFile.substring(sFile.lastIndexOf("\\")+1, sFile.lastIndexOf("."));
				System.Gadget.Settings.write("Caption", caption);
				image = sFile;
				System.Gadget.Settings.write("Image", sFile);
				addImage();
			}
				
			i++;
		}
	} catch(err) {}
}



//get the image dimensions
function getImageSize() {
	try{
		var img = new Image();
		img.src = image; // (Yozora #629) a URL here, not a file path
		if (img.width+img.height > 0)
		{
			if (img.width > img.height) {
				imageWidth = maxImageWidth;
				imageHeight = parseInt((imageWidth/img.width)*img.height);
			} else {
				imageHeight = maxImageHeight;
				imageWidth = parseInt((imageHeight/img.height)*img.width);
			}
			
			img = null;
			return true;
		} else {
		//catch errors
			imageWidth = maxImageWidth;
			imageHeight = maxImageHeight;
			window.setTimeout(addImage, 100);
		}
		img = null;
			
	} catch(err) {System.Debug.outputString("findImageSize: "+err)}

	return false;
}



//create the image and set the dimensions
function addImage() {
	try{
		//find the image dimensions and reduce to fit the Gadget
		if (getImageSize()) {
			//change the image source
			bodyImage.src = image;
			//clear the g:background
			bodyBackground.removeObjects();
	
			bodyImageSurroundBlur = bodyBackground.addImageObject("images/border.png", 0, 0);
			bodyImageSurround = bodyBackground.addImageObject("images/surround.png", 0, 0);
			//add the caption
			bodyText = bodyBackground.addTextObject(caption, textFont, textFontSize, "Black", 0, -1000);
			bodyTextVML.style.font = "normal normal normal " + textFontSize + " '" + textFont + "'";

			//hide the shape if the caption is blank, to get around a VML bug.
			if (caption == "")
				bodyTextShape.style.display = "none";
			else
				bodyTextShape.style.display = "inline";

			bodyTextVML.string = caption;
			bodyTextColour.color = textFontColour;

			//check if it's too wide, scale if necessary
			if (bodyText.width > maxImageWidth)
				bodyText.width = maxImageWidth;

			bodyWidth = imageWidth + imageBorder*2 + blurBorder*2;
			bodyHeight = imageHeight + ((caption == "") ? imageBorder*2 + blurBorder*2 : (imageBorder*2 + blurBorder*2 + textBorder + bodyText.height));

			//change the image dimensions
			bodyImage.style.width = imageWidth-1;
			bodyImage.style.height = imageHeight;

			bodyImageSurroundBlur.width=bodyWidth;
			bodyImageSurroundBlur.height=bodyHeight;
			bodyImageSurroundBlur.softEdge=blurBorder*1.1;

			//add the white border
			bodyImageSurround.width = bodyWidth-blurBorder*2;
			bodyImageSurround.height = bodyHeight-blurBorder*2;
			
			//work out half the difference to correct a bug in Sidebar
			bodyImageSurroundXoffset = parseInt((300 - bodyWidth)/2);
			bodyImageSurroundYoffset = parseInt((300 - bodyHeight)/2);

			setRotation(imageRotation);
		}
	} catch(err) {System.Debug.outputString("addImage: "+err)}
}



//change the image rotation
function setRotation(rotation) {
//	System.Gadget.beginTransition();

	try{
		imageRotation = rotation;
		
		//rotate the image and recalculate the extents
 		bodyImageSurround.rotation = rotation;
 		bodyImageSurroundBlur.rotation = rotation;

		//calculate text rotation
		var r = calcPoint(2000,0, 0,0);
		bodyTextPath.v = "m 0,0 l "+parseInt(r[0])+","+parseInt(r[1]);

		bodyImage.rotation = rotation;
		aliasTop.rotation = rotation;
		aliasLeft.rotation = rotation;
		imgDrag.rotation = rotation;

		//calculate the gadget extents	
		var c1 = calcPoint(0, 0, bodyWidth/2, bodyHeight/2);
		var c2 = calcPoint(bodyWidth, 0, bodyWidth/2, bodyHeight/2);
		var c3 = calcPoint(bodyWidth, bodyHeight, bodyWidth/2, bodyHeight/2);
		var c4 = calcPoint(0, bodyHeight, bodyWidth/2, bodyHeight/2);
	
		//what's the left extent
		var xLeft = 10000;
		xLeft = (c1[0] < xLeft) ? c1[0] : xLeft;
		xLeft = (c2[0] < xLeft) ? c2[0] : xLeft;
		xLeft = (c3[0] < xLeft) ? c3[0] : xLeft;
		xLeft = (c4[0] < xLeft) ? c4[0] : xLeft;
	
		//what's the right extent
		var xRight = -10000;
		xRight = (c1[0] > xRight) ? c1[0] : xRight;
		xRight = (c2[0] > xRight) ? c2[0] : xRight;
		xRight = (c3[0] > xRight) ? c3[0] : xRight;
		xRight = (c4[0] > xRight) ? c4[0] : xRight;
	
		//what's the bottom extent
		var yBottom = 10000;
		yBottom = (c1[1] < yBottom) ? c1[1] : yBottom;
		yBottom = (c2[1] < yBottom) ? c2[1] : yBottom;
		yBottom = (c3[1] < yBottom) ? c3[1] : yBottom;
		yBottom = (c4[1] < yBottom) ? c4[1] : yBottom;
	
		//what's the top extent
		var yTop = -10000;
		yTop = (c1[1] > yTop) ? c1[1] : yTop;
		yTop = (c2[1] > yTop) ? c2[1] : yTop;
		yTop = (c3[1] > yTop) ? c3[1] : yTop;
		yTop = (c4[1] > yTop) ? c4[1] : yTop;
	
		//set the white/black surround position
		bodyImageSurround.left = parseInt(-xLeft-bodyImageSurroundXoffset);
		bodyImageSurround.top = parseInt(-yBottom-bodyImageSurroundYoffset);
		bodyImageSurroundBlur.left = parseInt(-xLeft-bodyImageSurroundXoffset);
		bodyImageSurroundBlur.top = parseInt(-yBottom-bodyImageSurroundYoffset);
	
		//set the gadget width and height
		document.body.style.width = parseInt(xRight-xLeft + 1);
		document.body.style.height = parseInt(yTop-yBottom + 1);

		//calculate the top left for the aliased edges and image
		var o1 = calcPoint(imageBorder+blurBorder-1, imageBorder+blurBorder-2, imageBorder+blurBorder, bodyHeight/2-2);
		if (caption != "") {
			var o2 = calcPoint(imageBorder+blurBorder-2, imageBorder+blurBorder-1, bodyWidth/2-2, imageBorder+blurBorder+(bodyText.height+textBorder)/2-1);
			var o3 = calcPoint(imageBorder+blurBorder, imageBorder+blurBorder, imageBorder+blurBorder+1, (bodyText.height+textBorder)/2+imageBorder+blurBorder);
		} else {
			var o2 = calcPoint(imageBorder+blurBorder-2, imageBorder+blurBorder-1, bodyWidth/2-1, imageBorder+blurBorder-1);
			var o3 = [imageBorder+blurBorder, imageBorder+blurBorder];
		}

		aliasTop.style.left = parseInt(o1[0]-xLeft);
		aliasTop.style.top = parseInt(o1[1]-yBottom);
		aliasTop.style.width = imageWidth+1;
		aliasTop.style.height = (imageBorder<3) ? 0 : 3;
		aliasLeft.style.left = parseInt(o2[0]-xLeft);
		aliasLeft.style.top = parseInt(o2[1]-yBottom);
		aliasLeft.style.width = (imageBorder<3) ? 0 : 4;
		aliasLeft.style.height = imageHeight+2;
		bodyImage.style.left = parseInt(o3[0]-xLeft)
		bodyImage.style.top = parseInt(o3[1]-yBottom);

		//calculate the caption position
		var t = calcPoint(bodyWidth/2-13, imageHeight+imageBorder+blurBorder+textBorder, bodyWidth/2, bodyHeight/2-bodyText.height/2);

		//set the caption position	
		bodyTextShape.style.left = parseInt(t[0]-xLeft);
		bodyTextShape.style.top = parseInt(t[1]-yBottom)+textFontSize-2;
		
		//calculate the resize box position
		var t = calcPoint(bodyWidth-blurBorder-20, bodyHeight-blurBorder-20,  bodyWidth/2, bodyHeight/2);
		imgDrag.style.left = parseInt(t[0]-xLeft);
		imgDrag.style.top = parseInt(t[1]-yBottom);
	} catch(err) {System.Debug.outputString("setRotation: "+err)}

//	System.Gadget.endTransition(System.Gadget.TransitionType.none, 0);
}


	
//calculate a point rotated about a centre	
function calcPoint(x, y, centreX, centreY) {
	var xC = x - centreX;
	var yC = y - centreY;
	var xn = xC * Math.cos(imageRotation / 180 * Math.PI) - yC * Math.sin(imageRotation / 180 * Math.PI);
	var yn = yC * Math.cos(imageRotation / 180 * Math.PI) + xC * Math.sin(imageRotation / 180 * Math.PI);

	return [parseInt(xn + centreX), parseInt(yn + centreY)]; 
}



//update settings when the settings page closes
function SettingsClosed() {
	readSettings();
	addImage();
}

function readSettings() {
	image =  System.Gadget.Settings.readString("Image");
	imageRotation =  System.Gadget.Settings.read("Rotation");
	maxImageHeight = System.Gadget.Settings.read("maxImageWidth");
	maxImageWidth = System.Gadget.Settings.read("maxImageWidth");
	caption = System.Gadget.Settings.readString("Caption");
	imageBorder =  System.Gadget.Settings.read("imageBorder");
	textBorder =  System.Gadget.Settings.read("textBorder");
	textFont =  System.Gadget.Settings.readString("textFont");
	textFontSize =  System.Gadget.Settings.read("textFontSize");
	textFontColour =  System.Gadget.Settings.readString("textFontColour");
	blurBorder = System.Gadget.Settings.read("blurBorder");
}


//initiate Gadget resize
var cWidth, cHeight, dragStartX, dragStartY;
function initiateDrag() {
	cWidth = maxImageWidth;
	cHeight = maxImageHeight;
	dragStartX = event.clientX;
	dragStartY = event.clientY;

	imgDrag.setCapture();
 	imgDrag.onmouseup = function () {
 		imgDrag.onmousemove = null;
 		imgDrag.releaseCapture();
		imgDrag.onmouseup = null;
 	}
	imgDrag.onmousemove = function() {
		var dragWidth = cWidth + event.clientX - dragStartX;
		var dragHeight = cHeight + event.clientY - dragStartY;

		if (dragWidth < 50) dragWidth = 50;
		if (dragHeight < 50) dragHeight = 50;

		maxImageWidth = dragWidth;
		maxImageHeight = dragHeight;
		addImage();
		System.Gadget.Settings.write("maxImageWidth", maxImageWidth);
		System.Gadget.Settings.write("maxImageHeight", maxImageHeight);
	}
}



//initiate rotation
function initiateRotation() {
try{
	initialRotation = imageRotation;
	sMouseX = event.screenX;
	document.body.style.cursor = "url("+System.Gadget.path+"\\images\\rotate.cur)";

	document.body.setCapture();
	document.body.onclick = function () {
		document.body.onmousemove = null;
		document.body.releaseCapture();
		document.body.style.cursor = "default";
		document.body.onclick = null;
	}
	document.body.onmousemove = function () {
		var d = parseInt((-(sMouseX - event.screenX) + initialRotation)+360) % 360;
	
		System.Gadget.Settings.write("Rotation", d);
		setRotation(d);
	}

} catch(err) {System.Debug.outputString(err.name+" - "+err.message)}
}