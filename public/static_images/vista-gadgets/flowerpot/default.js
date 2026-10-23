

var kMaxFlowerState = 5;
var kMaxLeaveState  = 4;
var kNumTries       = 10;
var kBonusPets      = 100;
var kAbandonTries   = 2880; // Shrink once a day

var mouseOverCount  = 0;
var kShakeLimit     = 1;
var kMaxRainOpacity = 80;

var kFadeOutLength  = 1500;
var kFadeInLength   = 1500;
var kFadeOutOpacity = 0;
var kFadeInOpacity  = 0;
var kMaxOpacity     = 100;

var animationTimer = 0;
var randomNumbers   = null;

var random_i        = 0;

var kGrowTime = 30000; // 9 seconds

var names  = ["leaves1", "leaves2",
              "Flower1", "Flower2", "Flower3",
              "Flower4", "Flower5", "Flower6"];

var imgs   = ["leaves1", "leaves2",
              "Flower1", "Flower2", "Flower3",
              "Flower3", "Flower4", "Flower5"];
var setIntervalTimer;
//
// Initialize options
//
var kPetCount = "pet count";
var kAbandonCount = "abandon";
//for (var i = 0; i < names.length; ++i) {
  //options.defaultValue(names[i]) = "1";////////////////////////////////////
//}
//options.defaultValue(kPetCount) = "0";/////////////////////////
//options.defaultValue(kAbandonCount) = "0";/////////////////////////

//
// Initialize menu
//
//////////pluginHelper.onAddCustomMenuItems = function(menu) {////////////////////////
//////////  menu.AddItem(MENU_RESET, 0, OnReset);
/////////}

//
// OnReset
//
function OnReset() {
  options_removeAll();
  view_init();
}

//
// view_init
//
function view_init() {
  for (var i = 0; i < names.length; ++i) {
    //view.children(names[i]).src = GetImgName(i);
    document.getElementById(names[i]).src = GetImgName(i);
    document.getElementById(names[i]).opacity=100;
    document.getElementById(GetTempElemName(i)).opacity= 0;
  }
}

//
// view_onopen
//
function view_onopen() {
  view_init();
  setIntervalTimer=setInterval(growNext, kGrowTime);
 setTimeout(growNext, 10000);
 flowerpot.pageOnload();
}

//
// flowers_onmouseover
//
function flowers_onmouseover() {
  var pet_count = GetPetCount() + 1;

  SetPetCount(pet_count);
  SetAbandonCount(0);
  if (pet_count > kBonusPets) {
    growNext();
  }

  // rain settings
  if (mouseOverCount >= kShakeLimit) {
    return;
  }

  mouseOverCount++;
  resetAnimation();
   
 setTimeout(afterResetAnimation ,50);
}

function afterResetAnimation(){
setTimeout(startFadeOut, 3550);
  if (mouseOverCount == 1) {
    beginAnimation("FadeRain({value})", 0, kMaxRainOpacity, 500);//////////////////
  }
  // animationTimer = beginAnimation("_animate(animated,{value})", 0, 500, 4000);//////////////////
animationTimer =1;beginAnimation("_animate(animated,{value})", 0, 500, 4000);
}

function growNext() {
  var growth;
  var pet_count = GetPetCount();
  var abandon_count = GetAbandonCount();
  if (pet_count > 0) {
    growth = 1;
  } else if (abandon_count > kAbandonTries) {
    growth = -1;
    SetAbandonCount(0);
  } else {
    SetAbandonCount(abandon_count + 1);
    return;
  }

  SetPetCount(0);

  var index, state;
  var i;
  for (i = 0; i < kNumTries; ++i) {
    index = GetNextRandom();
    state = GetState(index);
    if (growth > 0) {
      if ((index < 2 && state < kMaxLeaveState) ||
          (index >= 2 && state < kMaxFlowerState)) {
        break;
      }
    } else { // shrinking
      if (state > 1) {
        break;
      }
    }
  }

  if (i == kNumTries) {
    return;
  }

  state += growth;
  SetState(index, state);

  //view.insertElement(GetNextElementXML(index), view.children(names[index]));
	//view_insertElement(GetNextElementXML(index), document.getElementById(names[index]));
	document.getElementById(GetTempElemName(index)).src=GetImgName(index);
  	document.getElementById(GetTempElemName(index)).opacity=kFadeInOpacity;

	/////////////////////////////////////////
  beginAnimation("_FadePlant(\""+names[index]+"\",{value})",kMaxOpacity, kFadeOutOpacity, kFadeOutLength);
 beginAnimation("_FadePlant(\""+GetTempElemName(index)+"\",{value})",kFadeInOpacity, kMaxOpacity, kFadeInLength);

  setTimeout("_RemoveNextElementXML("+index+")", kFadeInLength + 500);
}

//
// ANIMATE RAIN
//
function resetAnimation() {
  //clearInterval(animationTimer);
   animationTimer =0;
  //animated.style.filter="alpha(opacity= 69)";
  SetAnimatedOpacity (0);
}

function _animate(element,value) {
  var e = new Enumerator(element.children);
  for (; !e.atEnd(); e.moveNext()) {
    e.item().style.top = Math.abs((e.item().offsetTop + 1) % (element.offsetHeight - 11))+"px";
    var delta = GetRandomOpacityDelta();
    var opacity = e.item().opacity + delta;
    if (opacity < 100 && opacity > kMaxRainOpacity - 10) {
      e.item().opacity=opacity;
    }
  }
}

function _FadePlant(name,event_value) {
  document.getElementById(name).opacity=event_value;
}

// Gracefully end the rain
function startFadeOut() {
  if (mouseOverCount == 1) {
  	setTimeout("mouseOverCount--", 500);
    beginAnimation("FadeRain({value})", kMaxRainOpacity, 0, 500);//////////////////
  }
}

function FadeRain(event_value) {
  //animated.style.filter="alpha(opacity="+event_value+")";
  SetAnimatedOpacity (event_value);
}


function GetRandomOpacityDelta() {
  // Only generate random numbers once
  randomNumbers = [];
  if (randomNumbers == null) {
    for (var i = 0; i < 25; ++i) {
      var rand = Math.random();
      randomNumbers[i] = Math.round((rand * 10.0) / 2.0);
    }
  }

  random_i = (random_i + 1) % 25;
  return randomNumbers[random_i];
}


//
// Util functions
//

function GetNextRandom() {
  var max = names.length - 1;
  return Math.round((Math.random() * (max)) / 1.0);
}

function GetNextElementXML(index) {
  var element = document.getElementById(names[index]);
  var ret = "<g:image name=\"" + GetTempElemName(index) + "\" id=\"" + GetTempElemName(index) + "\"";
  ret += " src=\"" + GetImgName(index) + "\"";
  ret += " style=\"top:" + element.offsetTop + "px;left:" + element.offsetLeft + "px;position:fixed;\"";
  ret += " opacity=\"" + kFadeInOpacity + "\" ";
  ret += " />";
  return ret;
 
}

function _RemoveNextElementXML(index) {
//div_update.innerHTML="del"+index+document.getElementById(GetTempElemName(index)).src;
  document.getElementById(names[index]).src = GetImgName(index);
  //document.getElementById(names[index]).src = document.getElementById(GetTempElemName(index)).src;
  document.getElementById(names[index]).opacity=kMaxOpacity;
  //view.removeElement(view.children(GetTempElemName(index)));
 //view_removeElement(document.getElementById(GetTempElemName(index)));
//setTimeout("view_removeElement(document.getElementById(GetTempElemName("+index+")));",800);
document.getElementById(GetTempElemName(index)).opacity=0;

// div_update.innerHTML+="del"+index;

}


function GetImgName(index) {
  return "images/"+imgs[index] + "_" + GetState(index) + ".png";
}

function GetTempElemName(index) {
  return names[index] + "_";
}

function GetState(index) {
  return Number(getoptions(names[index]));
}

function SetState(index, state) {
  saveoptions(names[index],String(state));
}

function GetPetCount() {
  return Number(getoptions(kPetCount));
}

function SetPetCount(count) {
  saveoptions(kPetCount,String(count));
}

function GetAbandonCount() {
  return Number(getoptions(kAbandonCount));
}

function SetAbandonCount(count) {
  saveoptions(kAbandonCount,String(count));
}
////////////////////////
var flowerpot = new function(){
	//页面载入
	this.pageOnload= function(){		
		document.getElementById("button_restart").title=L_localizedStrings_RESET;		
		try{			
			System.Gadget.Flyout.file ="Flyout.html";
			System.Gadget.Flyout.onHide = flowerpot.FlyoutClosed;
    	}catch(err){}
    	document.getElementById("weblink").href="http://kakanow.com"+LangCode2kaka(L_localizedStrings_code)+"/?utm_source=FlowerPot&utm_medium=Main";
    	document.getElementById("check_update").src="http://gadget.kakanow.com/programdata/FlowerPotUpdate.js";
	}
	this.OpenFlyout= function(){
		try {
			animationTimer =0;
			document.getElementById('button_restart').style.display="block";
			System.Gadget.Flyout.show = true;
			setTimeout("document.getElementById('button_info').focus();",100);
		} catch (err){}
	}
	this.FlyoutClosed= function(){
		document.getElementById('button_restart').style.display="none";
	}
}
function getoptions(name){
	try{
		var v=System.Gadget.Settings.read(name);
    	if (v) {
    		return v;
    	}else{
    		if (name==kPetCount||name==kAbandonCount){return "0";}
    		else{return "1";}
    	}
    }catch(err){return "2";}
}
function saveoptions(name,value){
	try{
		System.Gadget.Settings.write(name,value);
	}catch(err){}
}

function options_removeAll(){
	for (var i = 0; i < names.length; ++i) {
		saveoptions(names[i],"1");
	}
	saveoptions(kPetCount,"0");
	saveoptions(kAbandonCount,"0");
}

function view_insertElement(xml,InsertBefore){
	var n=document.createElement(xml);
	view.insertBefore(n,InsertBefore);
}
function view_removeElement(Item){
	view.removeChild(Item);
}
	
function beginAnimation(script,startValue,endValue,duration){
	doAnimation(script,startValue,endValue,duration,startValue);
	
}

function doAnimation(script,startValue,endValue,duration,value){
	if (script=="_animate(animated,{value})"&&animationTimer==0){return false;}
	var ss=	script.replace("{value}",value)+";"
	eval(ss);
	if (startValue==endValue)return false;	
	if (startValue<endValue){
		if (value<endValue){
			value++;
			var d =duration/(endValue-startValue);
			if(d<=1){d=d*40;value-=39}else if(d<=5){d=d*15;value+=14}else if(d<=10){d=d*5;value+=4}
			var s="doAnimation(\'"+script+"\',"+startValue+","+endValue+","+duration+","+value+")";
			setTimeout(s,d);
		}else{return true;}
	}else{
		if (value>endValue){
			value--;
			var d =duration/(startValue-endValue);
			if(d<=1){d=d*40;value-=39}else if(d<=5){d=d*15;value-=14}else if(d<=10){d=d*5;value-=4}
			var s="doAnimation(\'"+script+"\',"+startValue+","+endValue+","+duration+","+value+")";
			setTimeout(s,d);
		}else{return true;}
	}
}
function SetAnimatedOpacity (opacity){
	var e = new Enumerator(animated.children);
	for (; !e.atEnd(); e.moveNext()) {
		e.item().opacity=opacity;
	}
}
function LangCode2kaka(a){var b="/"+a;return b.replace('zh-CHS','zh-CN').replace('zh-CHT','zh-TW').replace('he','iw').replace('pt-PT','pt').replace('/en','');}
