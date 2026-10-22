function show_job()
{
	document.getElementById("title").innerHTML = System.Gadget.document.parentWindow.xmlDoc.getElementsByTagName("item")[System.Gadget.document.parentWindow.rss_selected].getElementsByTagName("title")[0].text;
	document.getElementById("description").innerHTML = System.Gadget.document.parentWindow.xmlDoc.getElementsByTagName("item")[System.Gadget.document.parentWindow.rss_selected].getElementsByTagName("description")[0].text;
	document.getElementById("pubdate").innerHTML = System.Gadget.document.parentWindow.xmlDoc.getElementsByTagName("item")[System.Gadget.document.parentWindow.rss_selected].getElementsByTagName("pubDate")[0].text;
	document.getElementById("button").href = System.Gadget.document.parentWindow.xmlDoc.getElementsByTagName("item")[System.Gadget.document.parentWindow.rss_selected].getElementsByTagName("link")[0].text;
}