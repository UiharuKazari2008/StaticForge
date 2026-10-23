function loadSettings() {
	var store=System.Gadget.Settings.read("balls");
	if(store!="") {
		balls.value=store;
	}else {
		balls.value=5;
	}
	store=System.Gadget.Settings.read("spd");
	if(store!="") {
		spd.value=store;
	}else {
		spd.value=1;
	}
/*	store=System.Gadget.Settings.read("friction");
	if(""+store == "0") {
		friction.checked=false;
	}else {
		friction.checked=true;
	}*/
	System.Gadget.onSettingsClosing=Close;
}

function Close(event) {
	if(event.closeAction==event.Action.commit) {
		if (balls.value.length > 0 && balls.value*1 > 0) {
			System.Gadget.Settings.write("balls",balls.value);
		}
		
		System.Gadget.Settings.write("spd",""+spd.value);
/*		if (friction.checked) {
			System.Gadget.Settings.write("friction","1");
		}else {
			System.Gadget.Settings.write("friction","0");
		}*/
	}
}
	
function numbersonly(characters, myfield, e, dec){
	var key;
	var keychar;

	if (window.event)
		key = window.event.keyCode;
	else if (e)
		key = e.which;
	else
		return true;
	keychar = String.fromCharCode(key);

	// control keys
	if ((key==null) || (key==0) || (key==8) || (key==9) || (key==13) || (key==27) )
		return true;

	// numbers
	else if (((characters).indexOf(keychar) > -1))
		return true;

	// decimal point jump
	else if (dec && (keychar == ".")){
		myfield.form.elements[dec].focus();
		return false;
	}else
		return false;
}