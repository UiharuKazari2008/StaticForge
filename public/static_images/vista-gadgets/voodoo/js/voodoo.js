fps = 120;
var doll_parts = ['head', 'body', 'left_hand', 'right_hand', 'left_leg', 'right_leg'];
var pin_sets = [];
root = this;
function gadgetStart() {
	System.Gadget.onUndock = checkState;
	System.Gadget.onDock = checkState;
	checkState();
}
function loadMain() {
	gadgetStart();
	initialize();
}
function checkState() {
	if (!System.Gadget.docked) {
		dockedState();
	} else {
		dockedState();
	}
}
function dockedState() {
	with (document.body.style) {
		width = 128;
		height = 232;
	}
	System.Gadget.background = "url(images/baseboard.png)";
}
function dollShudder(){
	dollTweener.tweenPosY((dollTweener.original_top+(1*genRandomMod())), .2, "ElasticEaseOut", "rewind");
	dollTweener.tweenPosX((dollTweener.original_left+(1*genRandomMod())), .2, "ElasticEaseOut", "rewind");
}
function pardon() {
	removeAllPins();
	dollShudder()
	raiseDoll()
}
function addPin(index) {
	for (i=1; i<=pin_sets[index][0]; i++) {
		var pin_div = doll_parts[index]+'_pin'+i;
		var div_ref = document.getElementById(pin_div);
		div_ref.style.visibility = "visible";
	}
}
function genRandomMod() {
	var rand = (Math.round(Math.random()));
	if (rand == 0) {
		var rand_mod = 1;
	}
	if (rand == 1) {
		var rand_mod = -1;
	}
	return (rand_mod);
}
function pinDoll(part) {	
	//get index of part		
	for (i=0; i<doll_parts.length; i++) {
		if (doll_parts[i] == part) {
			var part_index = i;
			break;
		}
	}
	//root[doll_parts[part_index]+'_tweener'].tweenPosY((root[doll_parts[part_index]+'_tweener'].original_top+(2*genRandomMod())),.2,"ElasticEaseOut","rewind")
	//root[doll_parts[part_index]+'_tweener'].tweenPosX((root[doll_parts[part_index]+'_tweener'].original_left+(2*genRandomMod())),.2,"ElasticEaseOut","rewind")
	//dollTweener.tweenPosY((dollTweener.original_top+(1*genRandomMod())),.2,"ElasticEaseOut","rewind")
	//dollTweener.tweenPosX((dollTweener.original_left+(1*genRandomMod())),.2,"ElasticEaseOut","rewind")
	if (pin_sets[part_index][0]<pin_sets[part_index][1]) {
		if (part == 'body') {
			dollShudder()
		} else {
			root[doll_parts[part_index]+'_tweener'].tweenPosY((root[doll_parts[part_index]+'_tweener'].original_top+(2*genRandomMod())), .2, "ElasticEaseOut", "rewind");
			root[doll_parts[part_index]+'_tweener'].tweenPosX((root[doll_parts[part_index]+'_tweener'].original_left+(2*genRandomMod())), .2, "ElasticEaseOut", "rewind");
		}
		pin_sets[part_index][0] += 1;
		addPin(part_index);
	}
	//--check if all pin is used
	var total_pin=0
	var used_pin=0
	for(i=0;i<pin_sets.length;i++){
		total_pin+=pin_sets[i][1]
	}
	for(i=0;i<pin_sets.length;i++){
		used_pin+=pin_sets[i][0]
	}
	if(total_pin==used_pin){
		dropDoll()
	}
	
}
function raiseDoll(){
	for(i=0;i<doll_parts.length;i++){
		root[doll_parts[i]+'_tweener'].tweenPosY(root[doll_parts[i]+'_tweener'].original_top,.2,"QuadEaseIn")
	}
}
function dropDoll(){
	var ground=160
	for(i=0;i<doll_parts.length;i++){
		var div_ref=document.getElementById(doll_parts[i]);		
		var distance_from_ground=ground-(parseInt(div_ref.style.top)+div_ref.offsetHeight)		
		var drop_mod=Math.round(distance_from_ground/ground*100)
		//alert(distance_from_ground)
		root[doll_parts[i]+'_tweener'].tweenPosY(drop_mod/100*ground,drop_mod/100*1,"BounceEaseOut")
	}
}
function initialize() {
	enumeratePins();
	removeAllPins();
	dollShudder()
}
function enumeratePins() {
	root.dollTweener = new tweener('doll');
	//root.dollTweener.tweenAlpha(100,5,"StrongEaseOut")
	for (i=0; i<doll_parts.length; i++) {
		root[doll_parts[i]+'_tweener'] = new tweener(doll_parts[i]+'_set');
		root[doll_parts[i]+'_tweener2'] = new tweener(doll_parts[i]);
		for (j=1; j<10; j++) {
			var pin_div = doll_parts[i]+'_pin'+j;
			var div_ref = document.getElementById(pin_div);
			if (div_ref == null) {
				break;
			}
			//root[pin_div+'_tween']=new tweener(pin_div) 
			//-- pin_sets[body part]=[active pins, total pins]
			pin_sets[i] = [j, j];
		}
	}
}
function removeAllPins() {
	for (i=0; i<doll_parts.length; i++) {
		for (j=1; j<10; j++) {
			var pin_div = doll_parts[i]+'_pin'+j;
			var div_ref = document.getElementById(pin_div);
			if (div_ref == null) {
				break;
			}
			//root[pin_div+'_tween'].tweenPosY(160,2,'BounceEaseOut') 
			div_ref.style.visibility = "hidden";
			pin_sets[i][0] = 0;
		}
	}
}
