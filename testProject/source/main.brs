Sub RunUserInterface()
    screen = CreateObject("roSGScreen")
    m.scene = screen.CreateScene("HomeScene")
    port = CreateObject("roMessagePort")
    screen.SetMessagePort(port)
    screen.Show()


    'urls = util_findServerUrls(["192.168.1.8", "192.168.1.20"])
    'b_printc("urls: ", urls)

    while(true)
        msg = wait(0, port)
    end while
    
    if screen <> invalid then
        screen.Close()
        screen = invalid
    end if
End Sub
