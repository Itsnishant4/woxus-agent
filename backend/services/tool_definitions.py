"""Woxus — Gemini tool function declarations.

Defines the OpenAPI-style schemas Gemini uses for function calling.
"""

from google.genai import types


# --- Terminal tool ---

terminal_declaration = types.FunctionDeclaration(
    name="terminal_exec",
    description=(
        "Execute a shell command on the user's machine. "
        "Use for: creating projects, installing packages, running builds, "
        "git operations, file system operations. "
        "For long-running commands, set background=true and poll status with terminal_status."
    ),
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "command": types.Schema(
                type=types.Type.STRING,
                description="Shell command to execute (e.g. 'cd ~/Desktop && npx create-react-app my-app')",
            ),
            "background": types.Schema(
                type=types.Type.BOOLEAN,
                description="Run in background (true for long commands). Returns task_id for status polling.",
                default=False,
            ),
            "timeout_seconds": types.Schema(
                type=types.Type.INTEGER,
                description="Max execution time before timeout. Default 30s, max 600s (10 min).",
                default=30,
            ),
        },
        required=["command"],
    ),
)

terminal_status_declaration = types.FunctionDeclaration(
    name="terminal_status",
    description="Check status of a background terminal task. Returns running/done/exit_code/stdout/stderr.",
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "task_id": types.Schema(
                type=types.Type.STRING,
                description="Task ID returned by terminal_exec with background=true",
            ),
        },
        required=["task_id"],
    ),
)

terminal_list_declaration = types.FunctionDeclaration(
    name="terminal_list_tasks",
    description="List all active and recently completed background terminal tasks.",
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={},
    ),
)


# --- File/Notes tool ---

write_file_declaration = types.FunctionDeclaration(
    name="write_file",
    description=(
        "Write content to a file on the user's machine. "
        "Use for: creating source files, writing notes, saving configs, "
        "generating project files. "
        "Allowed extensions: .py, .js, .ts, .jsx, .tsx, .html, .css, "
        ".json, .txt, .md, .yaml, .yml, .toml, .env, .gitignore, "
        ".sh, .bat, .ps1, .sql, .xml, .svg, .cfg, .ini."
    ),
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "filepath": types.Schema(
                type=types.Type.STRING,
                description="Absolute or home-relative path (e.g. '~/Desktop/my-app/src/index.ts')",
            ),
            "content": types.Schema(
                type=types.Type.STRING,
                description="Full file content to write",
            ),
        },
        required=["filepath", "content"],
    ),
)

read_file_declaration = types.FunctionDeclaration(
    name="read_file",
    description="Read a file's content from the user's machine.",
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "filepath": types.Schema(
                type=types.Type.STRING,
                description="Absolute or home-relative path to the file",
            ),
        },
        required=["filepath"],
    ),
)

list_dir_declaration = types.FunctionDeclaration(
    name="list_directory",
    description="List files and directories at a given path.",
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "path": types.Schema(
                type=types.Type.STRING,
                description="Absolute or home-relative directory path",
            ),
        },
        required=["path"],
    ),
)


# --- Memory tool ---

memory_create_declaration = types.FunctionDeclaration(
    name="memory_create",
    description="Store a memory/fact the user wants to remember. Memories persist across sessions.",
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "content": types.Schema(
                type=types.Type.STRING,
                description="The memory content to store (e.g. 'User prefers dark mode in all apps')",
            ),
            "importance": types.Schema(
                type=types.Type.INTEGER,
                description="Importance level 1-5 (5=critical, 1=trivial). Default 3.",
                default=3,
            ),
            "tags": types.Schema(
                type=types.Type.STRING,
                description="Optional comma-separated tags for categorization",
            ),
        },
        required=["content"],
    ),
)

memory_search_declaration = types.FunctionDeclaration(
    name="memory_search",
    description="Search stored memories by text query. Returns matching memories sorted by relevance.",
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "query": types.Schema(
                type=types.Type.STRING,
                description="Search query text",
            ),
            "limit": types.Schema(
                type=types.Type.INTEGER,
                description="Max results to return. Default 10.",
                default=10,
            ),
        },
        required=["query"],
    ),
)

memory_list_declaration = types.FunctionDeclaration(
    name="memory_list",
    description="List all stored memories, sorted by importance (highest first).",
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "limit": types.Schema(
                type=types.Type.INTEGER,
                description="Max results to return. Default 20.",
                default=20,
            ),
        },
    ),
)

memory_delete_declaration = types.FunctionDeclaration(
    name="memory_delete",
    description="Delete a memory by its ID.",
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "id": types.Schema(
                type=types.Type.STRING,
                description="Memory ID to delete",
            ),
        },
        required=["id"],
    ),
)


# --- Google Search tool ---
# Enables the model to search the web for up-to-date information

google_search_tool = types.Tool(
    google_search=types.GoogleSearch(),
)


# --- Tool list for registering with Gemini ---

agent_tools = [
    types.Tool(function_declarations=[
        terminal_declaration,
        terminal_status_declaration,
        terminal_list_declaration,
        write_file_declaration,
        read_file_declaration,
        list_dir_declaration,
        memory_create_declaration,
        memory_search_declaration,
        memory_list_declaration,
        memory_delete_declaration,
    ]),
    google_search_tool,
]
