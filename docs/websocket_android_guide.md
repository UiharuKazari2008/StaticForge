# StaticForge WebSocket API Guide for Android Apps

> **Superseded for API completeness:** Use **[docs/client-api/README.md](./client-api/README.md)** as the canonical reference (REST + WebSocket + auth, all domains). This guide remains useful for Kotlin-specific examples only.

This guide provides a comprehensive breakdown of how to connect to, authenticate with, and interact with the StaticForge web application via WebSocket for building Android applications.

## Table of Contents

1. [WebSocket Connection](#websocket-connection)
2. [Authentication](#authentication)
3. [Message Protocol](#message-protocol)
4. [Data Retrieval](#data-retrieval)
5. [Image Generation](#image-generation)
6. [Preset Management](#preset-management)
7. [Error Handling](#error-handling)
8. [Android Implementation](#android-implementation)
9. [Complete Example](#complete-example)

## WebSocket Connection

### Connection URL

The WebSocket connection uses the following URL pattern:

```kotlin
val protocol = if (isHttps) "wss://" else "ws://"
val host = "your-server-host.com" // e.g., "localhost:9220" or "staticforge.example.com"
val wsUrl = "$protocol$host"
```

**Important**: The server runs on port 9220 by default.

### Connection Establishment

```kotlin
class StaticForgeWebSocket(private val host: String, private val isSecure: Boolean = false) {
    private var webSocket: WebSocket? = null
    private val protocol = if (isSecure) "wss://" else "ws://"
    private val wsUrl = "$protocol$host"

    fun connect(): Boolean {
        return try {
            val request = Request.Builder().url(wsUrl).build()
            webSocket = OkHttpClient().newWebSocket(request, WebSocketListenerImpl())
            true
        } catch (e: Exception) {
            false
        }
    }
}
```

### Connection States

- **Connecting**: Initial connection attempt
- **Connected**: Successfully connected and authenticated
- **Disconnected**: Connection lost, will attempt reconnection
- **Error**: Connection failed or authentication error

## Authentication

### PIN-Based Authentication

StaticForge uses a 6-digit PIN code for authentication. Authentication occurs via HTTP POST before WebSocket connection.

#### HTTP Authentication Request

```kotlin
data class AuthRequest(
    val action: String = "login",
    val data: AuthData
)

data class AuthData(
    val pin: String // 6-digit PIN code
)

data class AuthResponse(
    val success: Boolean,
    val error: String? = null
)
```

#### Authentication Flow

```kotlin
suspend fun authenticate(pin: String, host: String): Result<Unit> {
    return try {
        val client = OkHttpClient()
        val requestBody = AuthRequest(data = AuthData(pin))

        val request = Request.Builder()
            .url("http${if (isSecure) "s" else ""}://$host/")
            .post(Json.encodeToString(requestBody).toRequestBody(JSON))
            .build()

        val response = client.newCall(request).execute()
        val authResponse = Json.decodeFromString<AuthResponse>(response.body?.string() ?: "")

        if (response.isSuccessful && authResponse.success) {
            Result.success(Unit)
        } else {
            Result.failure(Exception(authResponse.error ?: "Authentication failed"))
        }
    } catch (e: Exception) {
        Result.failure(e)
    }
}
```

**Note**: Authentication must be completed before establishing the WebSocket connection. The server will reject WebSocket connections without prior authentication.

## Message Protocol

### Message Structure

All WebSocket messages follow this JSON structure:

```kotlin
data class WebSocketMessage(
    val type: String,
    val requestId: String? = null,
    val data: JsonObject? = null,
    val error: String? = null
)
```

### Request ID Generation

Each request must have a unique request ID:

```kotlin
fun generateRequestId(): String {
    return "req_${System.currentTimeMillis()}_${UUID.randomUUID().toString().take(9)}"
}
```

### Message Types

#### Core Message Types

| Type | Description | Request/Response |
|------|-------------|------------------|
| `generate_preset` | Generate image from preset | Request |
| `generate_preset_response` | Generation result | Response |
| `get_presets` | Retrieve available presets | Request |
| `get_presets_response` | Preset list | Response |
| `load_preset` | Load specific preset data | Request |
| `load_preset_response` | Preset configuration | Response |
| `request_gallery` | Get gallery images | Request |
| `request_gallery_response` | Gallery data | Response |
| `request_image_metadata` | Get image metadata | Request |
| `request_image_metadata_response` | Image metadata | Response |
| `auth_error` | Authentication error | Server Message |
| `error` | General error | Server Message |
| `pong` | Ping response | Server Message |

## Data Retrieval

### Retrieving Presets

```kotlin
data class GetPresetsRequest(
    val page: Int = 1,
    val itemsPerPage: Int = 15,
    val searchTerm: String = ""
)

suspend fun getPresets(
    page: Int = 1,
    itemsPerPage: Int = 15,
    searchTerm: String = ""
): Result<PresetsResponse> {
    val requestId = generateRequestId()
    val message = WebSocketMessage(
        type = "get_presets",
        requestId = requestId,
        data = JsonObject(mapOf(
            "page" to JsonPrimitive(page),
            "itemsPerPage" to JsonPrimitive(itemsPerPage),
            "searchTerm" to JsonPrimitive(searchTerm)
        ))
    )

    return sendRequest(message, requestId)
}
```

### Loading Specific Preset

```kotlin
suspend fun loadPreset(presetName: String): Result<PresetData> {
    val requestId = generateRequestId()
    val message = WebSocketMessage(
        type = "load_preset",
        requestId = requestId,
        data = JsonObject(mapOf(
            "presetName" to JsonPrimitive(presetName)
        ))
    )

    return sendRequest(message, requestId)
}
```

### Retrieving Gallery Data

```kotlin
data class GalleryRequest(
    val viewType: String = "images", // "images", "scraps", "pinned", "upscaled"
    val includePinnedStatus: Boolean = true
)

suspend fun getGallery(
    viewType: String = "images",
    includePinnedStatus: Boolean = true
): Result<GalleryResponse> {
    val requestId = generateRequestId()
    val message = WebSocketMessage(
        type = "request_gallery",
        requestId = requestId,
        data = JsonObject(mapOf(
            "viewType" to JsonPrimitive(viewType),
            "includePinnedStatus" to JsonPrimitive(includePinnedStatus)
        ))
    )

    return sendRequest(message, requestId)
}
```

### Retrieving Image Metadata

```kotlin
suspend fun getImageMetadata(filename: String): Result<ImageMetadata> {
    val requestId = generateRequestId()
    val message = WebSocketMessage(
        type = "request_image_metadata",
        requestId = requestId,
        data = JsonObject(mapOf(
            "filename" to JsonPrimitive(filename)
        ))
    )

    return sendRequest(message, requestId)
}
```

## Image Generation

### Generating from Preset

```kotlin
data class GeneratePresetRequest(
    val presetName: String,
    val allowPaid: Boolean = false,
    val workspace: String? = null
)

suspend fun generateFromPreset(
    presetName: String,
    allowPaid: Boolean = false,
    workspace: String? = null
): Result<GenerationResult> {
    val requestId = generateRequestId()
    val data = mutableMapOf<String, JsonElement>(
        "presetName" to JsonPrimitive(presetName),
        "allow_paid" to JsonPrimitive(allowPaid)
    )

    workspace?.let {
        data["workspace"] = JsonPrimitive(it)
    }

    val message = WebSocketMessage(
        type = "generate_preset",
        requestId = requestId,
        data = JsonObject(data)
    )

    return sendRequest(message, requestId)
}
```

### Generation Response

```kotlin
data class GenerationResult(
    val filename: String,
    val success: Boolean = true,
    val error: String? = null
)
```

### Monitoring Generation Progress

The server sends progress updates via `dynamic_generation_progress_update` messages:

```kotlin
// Handle progress updates in your WebSocket listener
override fun onMessage(webSocket: WebSocket, text: String) {
    val message = Json.decodeFromString<WebSocketMessage>(text)

    when (message.type) {
        "dynamic_generation_progress_update" -> {
            val progress = message.data?.get("progress")?.jsonPrimitive?.int
            val status = message.data?.get("status")?.jsonPrimitive?.content
            // Update UI with progress
            updateGenerationProgress(progress ?: 0, status ?: "")
        }
        // Handle other message types...
    }
}
```

## Preset Management

### Preset Data Structure

```kotlin
data class Preset(
    val name: String,
    val config: JsonObject,
    val created: String,
    val modified: String,
    val isPublic: Boolean = false
)

data class PresetsResponse(
    val presets: List<Preset>,
    val totalCount: Int,
    val page: Int,
    val itemsPerPage: Int
)
```

### Saving Presets

```kotlin
suspend fun savePreset(presetName: String, config: JsonObject): Result<Unit> {
    val requestId = generateRequestId()
    val message = WebSocketMessage(
        type = "save_preset",
        requestId = requestId,
        data = JsonObject(mapOf(
            "presetName" to JsonPrimitive(presetName),
            "config" to config
        ))
    )

    return sendRequest(message, requestId)
}
```

### Updating Presets

```kotlin
suspend fun updatePreset(presetName: String, updates: Map<String, JsonElement>): Result<Unit> {
    val requestId = generateRequestId()
    val message = WebSocketMessage(
        type = "update_preset",
        requestId = requestId,
        data = JsonObject(mapOf(
            "presetName" to JsonPrimitive(presetName)
        ) + updates)
    )

    return sendRequest(message, requestId)
}
```

### Deleting Presets

```kotlin
suspend fun deletePreset(presetName: String): Result<Unit> {
    val requestId = generateRequestId()
    val message = WebSocketMessage(
        type = "delete_preset",
        requestId = requestId,
        data = JsonObject(mapOf(
            "presetName" to JsonPrimitive(presetName)
        ))
    )

    return sendRequest(message, requestId)
}
```

## Error Handling

### Error Response Types

```kotlin
data class ErrorResponse(
    val type: String = "error",
    val message: String,
    val details: JsonObject? = null,
    val requestId: String? = null
)

data class AuthErrorResponse(
    val type: String = "auth_error",
    val message: String = "Authentication required",
    val code: String = "AUTH_REQUIRED"
)
```

### Handling Errors in Android

```kotlin
sealed class StaticForgeError : Exception() {
    data class AuthenticationError(val message: String) : StaticForgeError()
    data class NetworkError(val message: String) : StaticForgeError()
    data class ServerError(val message: String, val details: JsonObject? = null) : StaticForgeError()
}

fun handleWebSocketError(message: WebSocketMessage): StaticForgeError {
    return when (message.type) {
        "auth_error" -> StaticForgeError.AuthenticationError(message.error ?: "Authentication failed")
        "error" -> StaticForgeError.ServerError(
            message.error ?: "Server error",
            message.data
        )
        else -> StaticForgeError.NetworkError("Unknown error: ${message.type}")
    }
}
```

### Connection Error Handling

```kotlin
override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
    when (t) {
        is ConnectException -> {
            // Handle connection refused
            showError("Cannot connect to server. Please check your connection.")
            attemptReconnect()
        }
        is SSLHandshakeException -> {
            // Handle SSL certificate issues
            showError("SSL certificate verification failed.")
        }
        else -> {
            // Handle other network errors
            showError("Network error: ${t.localizedMessage}")
            attemptReconnect()
        }
    }
}
```

## Android Implementation

### Dependencies

Add these to your `build.gradle`:

```kotlin
dependencies {
    implementation 'com.squareup.okhttp3:okhttp:4.12.0'
    implementation 'org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.0'
    implementation 'androidx.lifecycle:lifecycle-viewmodel-ktx:2.7.0'
    implementation 'androidx.lifecycle:lifecycle-livedata-ktx:2.7.0'
}
```

### WebSocket Manager Class

```kotlin
class StaticForgeWebSocketManager(
    private val host: String,
    private val isSecure: Boolean = false
) {
    private val _connectionState = MutableLiveData<ConnectionState>()
    val connectionState: LiveData<ConnectionState> = _connectionState

    private val _messages = MutableLiveData<WebSocketMessage>()
    val messages: LiveData<WebSocketMessage> = _messages

    private var webSocket: WebSocket? = null
    private val client = OkHttpClient()
    private val pendingRequests = mutableMapOf<String, CompletableDeferred<JsonObject?>>()

    private val webSocketListener = object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            _connectionState.postValue(ConnectionState.Connected)
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            try {
                val message = Json.decodeFromString<WebSocketMessage>(text)
                _messages.postValue(message)

                // Resolve pending requests
                message.requestId?.let { requestId ->
                    pendingRequests[requestId]?.let { deferred ->
                        if (message.type.endsWith("_response")) {
                            if (message.error != null) {
                                deferred.completeExceptionally(Exception(message.error))
                            } else {
                                deferred.complete(message.data)
                            }
                            pendingRequests.remove(requestId)
                        }
                    }
                }
            } catch (e: Exception) {
                // Handle parsing errors
            }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            _connectionState.postValue(ConnectionState.Disconnected)
            // Attempt reconnection logic here
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            _connectionState.postValue(ConnectionState.Disconnected)
        }
    }

    fun connect() {
        _connectionState.value = ConnectionState.Connecting
        val protocol = if (isSecure) "wss://" else "ws://"
        val request = Request.Builder().url("$protocol$host").build()
        webSocket = client.newWebSocket(request, webSocketListener)
    }

    suspend fun sendRequest(message: WebSocketMessage): JsonObject? {
        val deferred = CompletableDeferred<JsonObject?>()
        message.requestId?.let { pendingRequests[it] = deferred }

        webSocket?.send(Json.encodeToString(message))

        return try {
            deferred.await()
        } catch (e: Exception) {
            pendingRequests.remove(message.requestId)
            throw e
        }
    }

    fun disconnect() {
        webSocket?.close(1000, "Client disconnect")
        _connectionState.value = ConnectionState.Disconnected
    }
}

enum class ConnectionState {
    Disconnected,
    Connecting,
    Connected,
    Error
}
```

### Repository Layer

```kotlin
class StaticForgeRepository(private val webSocketManager: StaticForgeWebSocketManager) {

    suspend fun authenticate(pin: String): Result<Unit> {
        // HTTP authentication implementation
        return authenticateViaHttp(pin)
    }

    suspend fun getPresets(page: Int = 1, searchTerm: String = ""): Result<List<Preset>> {
        return try {
            val requestId = generateRequestId()
            val message = WebSocketMessage(
                type = "get_presets",
                requestId = requestId,
                data = JsonObject(mapOf(
                    "page" to JsonPrimitive(page),
                    "searchTerm" to JsonPrimitive(searchTerm)
                ))
            )

            val response = webSocketManager.sendRequest(message)
            val presetsResponse = Json.decodeFromJsonElement<PresetsResponse>(response!!)
            Result.success(presetsResponse.presets)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun generateImage(presetName: String): Result<GenerationResult> {
        return try {
            val requestId = generateRequestId()
            val message = WebSocketMessage(
                type = "generate_preset",
                requestId = requestId,
                data = JsonObject(mapOf(
                    "presetName" to JsonPrimitive(presetName)
                ))
            )

            val response = webSocketManager.sendRequest(message)
            val result = Json.decodeFromJsonElement<GenerationResult>(response!!)
            Result.success(result)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
```

### ViewModel

```kotlin
class StaticForgeViewModel(private val repository: StaticForgeRepository) : ViewModel() {

    private val _presets = MutableLiveData<List<Preset>>()
    val presets: LiveData<List<Preset>> = _presets

    private val _generationState = MutableLiveData<GenerationState>()
    val generationState: LiveData<GenerationState> = _generationState

    private val _connectionState = MutableLiveData<ConnectionState>()
    val connectionState: LiveData<ConnectionState> = _connectionState

    fun authenticate(pin: String) {
        viewModelScope.launch {
            when (val result = repository.authenticate(pin)) {
                is Result.Success -> {
                    // Proceed with WebSocket connection
                    connectWebSocket()
                }
                is Result.Failure -> {
                    // Handle authentication failure
                    _connectionState.value = ConnectionState.Error
                }
            }
        }
    }

    fun loadPresets() {
        viewModelScope.launch {
            when (val result = repository.getPresets()) {
                is Result.Success -> {
                    _presets.value = result.data
                }
                is Result.Failure -> {
                    // Handle error
                }
            }
        }
    }

    fun generateImage(presetName: String) {
        viewModelScope.launch {
            _generationState.value = GenerationState.Generating
            when (val result = repository.generateImage(presetName)) {
                is Result.Success -> {
                    _generationState.value = GenerationState.Success(result.data)
                }
                is Result.Failure -> {
                    _generationState.value = GenerationState.Error(result.exception.localizedMessage ?: "Generation failed")
                }
            }
        }
    }

    private fun connectWebSocket() {
        // WebSocket connection logic
    }
}

sealed class GenerationState {
    object Idle : GenerationState()
    object Generating : GenerationState()
    data class Success(val result: GenerationResult) : GenerationState()
    data class Error(val message: String) : GenerationState()
}
```

## Complete Example

### MainActivity Implementation

```kotlin
class MainActivity : AppCompatActivity() {
    private lateinit var viewModel: StaticForgeViewModel
    private lateinit var webSocketManager: StaticForgeWebSocketManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // Initialize components
        webSocketManager = StaticForgeWebSocketManager("localhost:9220")
        val repository = StaticForgeRepository(webSocketManager)
        viewModel = ViewModelProvider(this, StaticForgeViewModelFactory(repository))
            .get(StaticForgeViewModel::class.java)

        // Observe connection state
        viewModel.connectionState.observe(this) { state ->
            updateConnectionStatus(state)
        }

        // Observe presets
        viewModel.presets.observe(this) { presets ->
            updatePresetsList(presets)
        }

        // Observe generation state
        viewModel.generationState.observe(this) { state ->
            updateGenerationUI(state)
        }

        // Set up authentication
        setupAuthentication()

        // Set up generate button
        findViewById<Button>(R.id.generateButton).setOnClickListener {
            val selectedPreset = getSelectedPreset()
            if (selectedPreset != null) {
                viewModel.generateImage(selectedPreset.name)
            }
        }
    }

    private fun setupAuthentication() {
        // Show PIN input dialog
        showPinInputDialog { pin ->
            viewModel.authenticate(pin)
        }
    }

    private fun updateConnectionStatus(state: ConnectionState) {
        val statusText = when (state) {
            ConnectionState.Connected -> "Connected"
            ConnectionState.Connecting -> "Connecting..."
            ConnectionState.Disconnected -> "Disconnected"
            ConnectionState.Error -> "Connection Error"
        }
        findViewById<TextView>(R.id.connectionStatus).text = statusText
    }

    private fun updatePresetsList(presets: List<Preset>) {
        val recyclerView = findViewById<RecyclerView>(R.id.presetsRecyclerView)
        recyclerView.adapter = PresetAdapter(presets) { preset ->
            // Handle preset selection
        }
    }

    private fun updateGenerationUI(state: GenerationState) {
        val generateButton = findViewById<Button>(R.id.generateButton)
        val progressBar = findViewById<ProgressBar>(R.id.generationProgress)

        when (state) {
            GenerationState.Idle -> {
                generateButton.isEnabled = true
                progressBar.visibility = View.GONE
            }
            GenerationState.Generating -> {
                generateButton.isEnabled = false
                progressBar.visibility = View.VISIBLE
            }
            is GenerationState.Success -> {
                generateButton.isEnabled = true
                progressBar.visibility = View.GONE
                showGeneratedImage(state.result.filename)
            }
            is GenerationState.Error -> {
                generateButton.isEnabled = true
                progressBar.visibility = View.GONE
                showError(state.message)
            }
        }
    }
}
```

## Key Considerations

1. **Authentication First**: Always authenticate via HTTP before attempting WebSocket connection
2. **Request ID Tracking**: Generate unique request IDs for all requests to correlate responses
3. **Error Handling**: Implement proper error handling for network issues and server errors
4. **Reconnection Logic**: Implement automatic reconnection with exponential backoff
5. **State Management**: Use LiveData or StateFlow to manage connection and data states
6. **Background Processing**: Use coroutines for all network operations
7. **Security**: Store authentication tokens securely and handle SSL properly
8. **UI Feedback**: Provide clear feedback for all operations (loading, success, error states)

## Additional Features

### Search and Filter Presets

```kotlin
suspend fun searchPresets(query: String): Result<List<Preset>> {
    // Implementation for searching presets
}
```

### Batch Operations

```kotlin
suspend fun generateMultipleImages(presetNames: List<String>): Result<List<GenerationResult>> {
    // Implementation for batch generation
}
```

### Real-time Progress Updates

```kotlin
// Observe WebSocket messages for progress updates
webSocketManager.messages.observe(this) { message ->
    when (message.type) {
        "dynamic_generation_progress_update" -> {
            // Update progress UI
        }
    }
}
```

This guide provides a comprehensive foundation for building an Android application that interacts with StaticForge via WebSocket. The implementation patterns shown can be adapted and extended based on your specific application requirements.
