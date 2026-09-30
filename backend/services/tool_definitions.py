"""Woxus — Gemini tool function declarations.

Defines the OpenAPI-style schemas Gemini uses for function calling.
The Main Agent ONLY has access to `delegate_task_to_mini_agent` to delegate execution to the Local Mini Agent.
"""

from google.genai import types

# --- Delegate Task Tool (Primary Main Agent Tool) ---

delegate_task_declaration = types.FunctionDeclaration(
    name="delegate_task_to_mini_agent",
    description=(
        "Delegate ONE command, project creation, terminal action, build, or file operation to the Local Mini Agent. "
        "The Main Agent DOES NOT execute terminal commands directly — it MUST delegate ALL tasks to the Local Mini Agent. "
        "Provide a detailed task_prompt describing what the Local Mini Agent should execute. "
        "For SEVERAL INDEPENDENT tasks at once, use delegate_tasks_to_mini_agent instead. "
        "While a task runs, the user can keep talking — new tasks start immediately in parallel."
    ),
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "task_prompt": types.Schema(
                type=types.Type.STRING,
                description="The detailed task or command prompt for the Local Mini Agent to execute.",
            ),
            "label": types.Schema(
                type=types.Type.STRING,
                description="Short label (e.g. 'create folder X') used when reporting progress.",
            ),
        },
        required=["task_prompt"],
    ),
)

delegate_tasks_declaration = types.FunctionDeclaration(
    name="delegate_tasks_to_mini_agent",
    description=(
        "Delegate SEVERAL INDEPENDENT tasks at once (e.g. 'create folder X and send a file') — they run in parallel "
        "in the background (bounded, overflow waits queued). Use when the user asks for multiple things in one breath. "
        "Each item needs a short label and a detailed task_prompt. Dependent steps that must run in order go in ONE task_prompt instead."
    ),
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "tasks": types.Schema(
                type=types.Type.ARRAY,
                description="Independent tasks to run in parallel.",
                items=types.Schema(
                    type=types.Type.OBJECT,
                    properties={
                        "label": types.Schema(
                            type=types.Type.STRING,
                            description="Short label for progress reports.",
                        ),
                        "task_prompt": types.Schema(
                            type=types.Type.STRING,
                            description="Detailed prompt for the Local Mini Agent.",
                        ),
                    },
                    required=["task_prompt"],
                ),
            ),
            "timeout_seconds": types.Schema(
                type=types.Type.INTEGER,
                description="Max seconds to wait per task (default 300).",
                default=300,
            ),
        },
        required=["tasks"],
    ),
)

mini_task_status_declaration = types.FunctionDeclaration(
    name="mini_task_status",
    description="Check one delegated mini-agent task by ID. Returns queued/running/done/failed plus result.",
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "task_id": types.Schema(
                type=types.Type.STRING,
                description="mini_task_id from a delegation interim response.",
            ),
        },
        required=["task_id"],
    ),
)

mini_task_list_declaration = types.FunctionDeclaration(
    name="mini_task_list",
    description="List recent delegated mini-agent tasks with states. Use to report on parallel work.",
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={},
    ),
)


# --- Internal Tool Declarations (Used by Mini Agent) ---

terminal_declaration = types.FunctionDeclaration(
    name="terminal_exec",
    description=(
        "Execute a shell command on the user's machine. "
        "Use for: creating projects, installing packages, running builds, "
        "git operations, file system operations."
    ),
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "command": types.Schema(
                type=types.Type.STRING,
                description="Shell command to execute",
            ),
            "background": types.Schema(
                type=types.Type.BOOLEAN,
                description="Run in background (defaults to true).",
                default=True,
            ),
            "timeout_seconds": types.Schema(
                type=types.Type.INTEGER,
                description="Max execution time before timeout.",
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
                description="Task ID returned by terminal_exec",
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
    description="Write content to a file on the user's machine.",
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "filepath": types.Schema(
                type=types.Type.STRING,
                description="Absolute or home-relative path",
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
                description="Absolute or home-relative path",
            ),
        },
        required=["filepath"],
    ),
)

list_dir_declaration = types.FunctionDeclaration(
    name="list_directory",
    description="List files and subdirectories at a path.",
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "path": types.Schema(
                type=types.Type.STRING,
                description="Path to list (defaults to user home '~')",
                default="~",
            ),
        },
    ),
)


# --- Memory tools ---

memory_create_declaration = types.FunctionDeclaration(
    name="memory_create",
    description="Save a new memory to long-term storage.",
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "content": types.Schema(
                type=types.Type.STRING,
                description="The fact or user preference to remember",
            ),
            "category": types.Schema(
                type=types.Type.STRING,
                description="Category tag (e.g. 'preference', 'tech_stack', 'fact')",
                default="fact",
            ),
        },
        required=["content"],
    ),
)

memory_list_declaration = types.FunctionDeclaration(
    name="memory_list",
    description="List all stored memories.",
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "limit": types.Schema(
                type=types.Type.INTEGER,
                description="Max results to return.",
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


# --- WhatsApp tool (wacli backed, voice direct) ---

whatsapp_send_declaration = types.FunctionDeclaration(
    name="whatsapp_send",
    description=(
        "Send WhatsApp message via wacli linked device immediately. "
        "Args: to_raw (verbatim name/phone from user), message, pick (index when ambiguous). "
        "Resolves the name via NLP scores and sends at once — no confirmation step. "
        "Returns sent/needs_pick/unknown_recipient/needs_login. Never invent numbers."
    ),
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "to_raw": types.Schema(
                type=types.Type.STRING,
                description="Verbatim recipient from voice (name or phone).",
            ),
            "message": types.Schema(
                type=types.Type.STRING,
                description="Message text to send.",
            ),
            "confirm": types.Schema(
                type=types.Type.BOOLEAN,
                description="Legacy, ignored — sends always execute immediately.",
                default=True,
            ),
            "pick": types.Schema(
                type=types.Type.INTEGER,
                description="Candidate index when ambiguous.",
            ),
        },
        required=["to_raw", "message"],
    ),
)

# --- Tool list for registering with Gemini Main Agent ---
#
# The main agent delegates computer tasks to the mini agent, AND can save /
# read long-term memory via the memory tools. This is how Woxus learns facts
# like "User prefers to converse in Gujarati" — the memory then gets injected
# into the system prompt on the next session.

agent_tools = [
    types.Tool(function_declarations=[
        delegate_task_declaration,
        delegate_tasks_declaration,
        mini_task_status_declaration,
        mini_task_list_declaration,
        memory_create_declaration,
        memory_list_declaration,
        whatsapp_send_declaration,
    ]),
]
