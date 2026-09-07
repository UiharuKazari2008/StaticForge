with open('modules/mcpRateLimiter.js', 'r') as f:
    content = f.read()

replacement = """    list_desktop_items: 'free',
    publish_apocrypha: 'write',
    revoke_apocrypha: 'write',
    get_apocrypha: 'free',
    deliver_cake: 'write',
    feed_cake: 'write',
    inspect_pantry: 'free',
    consume_cake: 'write',
    get_work_pile: 'free',
    add_work_item: 'write',
    complete_work_item: 'write',
    remove_work_item: 'write',
    report_issue: 'write',
    get_usage: 'free'"""

if "publish_apocrypha" not in content:
    content = content.replace("    list_desktop_items: 'free'", replacement)
    with open('modules/mcpRateLimiter.js', 'w') as f:
        f.write(content)
