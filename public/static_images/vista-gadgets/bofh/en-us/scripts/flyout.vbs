Function initFlyout()
    GenerateFlyoutLayout
End Function

Function GenerateFlyoutLayout()
    With document.body.style
        .height = "200px"
        .width = "400px"
        .backgroundImage = "url(images/detailBackground.png)"
    End With
    
    With divDetailFrame.style
        .height = "184px"
        .width = "384px"
        .padding = "4px"
        .font-size = "48px"
        .font-weight = "bold"        
    End With
End Function