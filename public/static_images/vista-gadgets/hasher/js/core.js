var gDockFlag = true;
var gFlyOpenFlag = false;

function $get(id) {
	return document.getElementById(id);
}
function show(id) {
	$get(id).style.visibility="visible";
	$get(id).style.display="block";
}
function hide(id) {
	$get(id).style.visibility="hidden";
	$get(id).style.display="none";
}
function findDOM(objectId) {
    if (document.getElementById) {
    return (document.getElementById(objectId));}
    if (document.all) {
    return (document.all[objectId]);}
}
function setSetting(name, value) {
	try {
        System.Gadget.Settings.write(name, value);        
        return true;
    }
    catch(ex) {    
        return false;
    }
}
function getSetting(name) {
    try {
        return System.Gadget.Settings.read(name);
    }
    catch(ex) {
        return null;
    }
}