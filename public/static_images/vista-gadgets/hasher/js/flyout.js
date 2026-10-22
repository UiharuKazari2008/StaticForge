function encrypt() {
	var str = getSetting("string2hash");
	var md4 = hex_md4(str);
	var md5 = hex_md5(str);
	var sha1 = hex_sha1(str);

	var output = "<table cellspacing='0' cellpadding='0' border='0'>" +
				 "<tr><td nowrap width='86%'><b>Result for: </b>'" + str + "'</td><td nowrap><a href='#' onclick='doProcFlyoutClose();'>[close]</a></td></tr>" +
				 "<tr><td nowrap colspan='2'><b>MD4 hash:</b></td></tr><tr><td colspan='2'><input type='text' value='" + md4 + "' class='encText' onclick='select(this);' /></td></tr>" +
				 "<tr><td nowrap colspan='2'><b>MD5 hash:</b></td></tr><tr><td colspan='2'><input type='text' value='" + md5 + "' class='encText' onclick='select(this);' /></td></tr>" +
				 "<tr><td nowrap colspan='2'><b>SHA-1 hash:</b></td></tr><tr><td colspan='2'><input type='text' value='" + sha1 + "' class='encText' onclick='select(this);' /></td></tr>" +
				 "</table>";

	findDOM('flyoutMainFrame').innerHTML = output;
}
function loadFlyout() {
	document.body.style.width = "258px";
	document.body.style.height = "130px";
	document.body.style.backgroundImage="url(images/200x120.png)";

	gFlyOpenFlag = true;

	encrypt();
}
function doProcFlyoutClose() {
  gFlyOpenFlag = false;
  System.Gadget.Flyout.show = false;
}