import sys

def main():
    with open('modules/mcpModuleRegistry.js', 'r') as f:
        content = f.read()

    old_line = "            'list_clients', 'bind_session', 'apply_studio_changes',"
    new_line = "            'list_clients', 'bind_session', 'apply_studio_changes', 'run_client_js', 'inspect_elements',"

    if old_line in content:
        content = content.replace(old_line, new_line)

    with open('modules/mcpModuleRegistry.js', 'w') as f:
        f.write(content)

if __name__ == "__main__":
    main()
