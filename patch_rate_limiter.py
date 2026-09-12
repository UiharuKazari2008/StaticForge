import sys

def main():
    with open('modules/mcpRateLimiter.js', 'r') as f:
        content = f.read()

    new_line = "    apply_studio_changes: 'studio',\n    run_client_js: 'studio',\n    inspect_elements: 'studio',"

    if "apply_studio_changes: 'studio'," in content:
        content = content.replace("apply_studio_changes: 'studio',", new_line)
    else:
        print("Could not find apply_studio_changes in mcpRateLimiter.js")

    with open('modules/mcpRateLimiter.js', 'w') as f:
        f.write(content)

if __name__ == "__main__":
    main()
