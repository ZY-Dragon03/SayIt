Option Explicit

Const SAYIT_PORT = 5173
Const SAYIT_URL = "http://127.0.0.1:5173/"
Const WINDOW_HIDDEN = 0
Const WAIT_FOR_EXIT = True

Dim shell, fileSystem, root, envPath, examplePath
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

root = fileSystem.GetParentFolderName(WScript.ScriptFullName)
envPath = fileSystem.BuildPath(root, ".env.local")
examplePath = fileSystem.BuildPath(root, ".env.example")

If IsCheckMode() Then
  WScript.Echo "Start SayIt launcher check passed."
  WScript.Echo "Project root: " & root
  WScript.Echo "package.json: " & fileSystem.FileExists(fileSystem.BuildPath(root, "package.json"))
  WScript.Echo "env example: " & fileSystem.FileExists(examplePath)
  WScript.Echo "vite binary: " & fileSystem.FileExists(fileSystem.BuildPath(root, "node_modules\.bin\vite.cmd"))
  WScript.Quit 0
End If

If IsServerReady() Then
  OpenBrowser()
  WScript.Quit 0
End If

If Not EnsureApiKeyFile() Then
  WScript.Quit 0
End If

If Not EnsureDependencies() Then
  WScript.Quit 1
End If

StartServer()

Dim attempt
For attempt = 1 To 60
  If IsServerReady() Then
    OpenBrowser()
    WScript.Quit 0
  End If
  WScript.Sleep 500
Next

MsgBox "SayIt did not become available within 30 seconds." & vbCrLf & _
       "Check the server log in your TEMP\SayIt folder.", _
       vbExclamation, "SayIt"
WScript.Quit 1

Function IsCheckMode()
  IsCheckMode = False
  If WScript.Arguments.Count > 0 Then
    IsCheckMode = (LCase(WScript.Arguments(0)) = "--check")
  End If
End Function

Function EnsureApiKeyFile()
  EnsureApiKeyFile = False

  If Not fileSystem.FileExists(envPath) Then
    If Not fileSystem.FileExists(examplePath) Then
      MsgBox "Missing .env.example. Restore the project files and try again.", _
             vbCritical, "SayIt setup"
      Exit Function
    End If

    fileSystem.CopyFile examplePath, envPath, False
    MsgBox "First-run setup is ready." & vbCrLf & vbCrLf & _
           "A .env.local file was created at the project root." & vbCrLf & _
           "Add your DEEPSEEK_API_KEY there, save it, then double-click Start SayIt again.", _
           vbInformation, "SayIt setup"
    Exit Function
  End If

  If Not HasConfiguredApiKey(envPath) Then
    MsgBox "Add a non-empty DEEPSEEK_API_KEY to .env.local, save it, " & _
           "then double-click Start SayIt again.", _
           vbExclamation, "SayIt setup"
    Exit Function
  End If

  EnsureApiKeyFile = True
End Function

Function HasConfiguredApiKey(path)
  Dim text, lines, line, value, index, file
  HasConfiguredApiKey = False

  On Error Resume Next
  Set file = fileSystem.OpenTextFile(path, 1, False)
  If Err.Number <> 0 Then
    Err.Clear
    On Error GoTo 0
    Exit Function
  End If
  text = file.ReadAll
  file.Close
  On Error GoTo 0

  text = Replace(text, vbCrLf, vbLf)
  text = Replace(text, vbCr, vbLf)
  lines = Split(text, vbLf)
  For Each line In lines
    If LCase(Left(Trim(line), 17)) = "deepseek_api_key=" Then
      index = InStr(1, line, "=", vbBinaryCompare)
      value = Trim(Mid(line, index + 1))
      If Len(value) > 0 And LCase(value) <> "your-key" Then
        HasConfiguredApiKey = True
        Exit Function
      End If
    End If
  Next
End Function

Function EnsureDependencies()
  Dim vitePath, exitCode
  EnsureDependencies = False
  vitePath = fileSystem.BuildPath(root, "node_modules\.bin\vite.cmd")

  If fileSystem.FileExists(vitePath) Then
    EnsureDependencies = True
    Exit Function
  End If

  exitCode = shell.Run("cmd.exe /d /s /c npm --version", WINDOW_HIDDEN, WAIT_FOR_EXIT)
  If exitCode <> 0 Then
    MsgBox "Node.js and npm are required. Install Node.js, then double-click Start SayIt again.", _
           vbCritical, "SayIt setup"
    Exit Function
  End If

  exitCode = shell.Run( _
    "cmd.exe /d /s /c cd /d " & Quote(root) & " && npm install", _
    WINDOW_HIDDEN, _
    WAIT_FOR_EXIT)
  If exitCode <> 0 Then
    MsgBox "Dependency installation failed. Run npm install from the project folder to inspect the error.", _
           vbCritical, "SayIt setup"
    Exit Function
  End If

  EnsureDependencies = fileSystem.FileExists(vitePath)
End Function

Sub StartServer()
  Dim tempRoot, logRoot, logPath, command
  tempRoot = shell.ExpandEnvironmentStrings("%TEMP%")
  logRoot = fileSystem.BuildPath(tempRoot, "SayIt")
  If Not fileSystem.FolderExists(logRoot) Then
    fileSystem.CreateFolder(logRoot)
  End If
  logPath = fileSystem.BuildPath(logRoot, "server.log")

  command = "cmd.exe /d /s /c cd /d " & Quote(root) & _
            " && npm run dev -- --host 127.0.0.1 --port " & SAYIT_PORT & _
            " > " & Quote(logPath) & " 2>&1"
  shell.Run command, WINDOW_HIDDEN, False
End Sub

Function IsServerReady()
  Dim http, body
  IsServerReady = False

  On Error Resume Next
  Set http = CreateObject("WinHttp.WinHttpRequest.5.1")
  http.SetTimeouts 500, 500, 500, 1000
  http.Open "GET", SAYIT_URL, False
  http.Send
  If Err.Number = 0 Then
    body = http.ResponseText
    IsServerReady = (http.Status = 200 And InStr(1, body, "SayIt", vbTextCompare) > 0)
  End If
  Err.Clear
  On Error GoTo 0
End Function

Sub OpenBrowser()
  shell.Run SAYIT_URL, 1, False
End Sub

Function Quote(value)
  Quote = """" & value & """"
End Function
