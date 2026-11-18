# Browser walkthrough against the demo backend:
#   cd backend && AUTH_MODE=local npm run demo     (fresh DB each start)
#   cd frontend && npm run dev
#   pip install playwright && playwright install chromium && python e2e/flows.py
from playwright.sync_api import sync_playwright, expect
B = "http://localhost:5173"
ok = lambda m: print("PASS ", m)
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1440, "height": 1100})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(B); pg.fill("input[autocomplete=username]", "admin"); pg.fill("input[type=password]", "demo-admin-123"); pg.click("button[type=submit]")
    pg.wait_for_selector(".hero__title"); ok("sign in")

    # add an integration and test it
    pg.goto(B + "/settings/connections"); pg.click("text=Add integration")
    pg.select_option("#c-type", "grafana"); pg.fill("#c-name", "Grafana main"); pg.fill("#c-url", "http://127.0.0.1:4100/grafana"); pg.fill("#c-token", "grafana-token")
    pg.click("form[aria-labelledby=conn-title] button[type=submit]")
    row = pg.locator("tr", has_text="grafana-main"); expect(row).to_be_visible(timeout=5000); ok("integration created")
    row.get_by_role("button", name="Test").click(); expect(row).to_contain_text("API key accepted", timeout=8000); ok("integration test from the table")

    # edit env, save, test
    pg.goto(B + "/settings?app=frontend-app&env=staging"); pg.wait_for_selector("#prom_selector")
    pg.select_option("#grafana_integration_id", "grafana-main"); pg.fill("#grafana_dashboard_uid", "d3f8a2bc")
    pg.click("text=Save environment"); expect(pg.get_by_text("Saved.")).to_be_visible(timeout=5000); ok("environment saved")
    pg.click("text=Test environment"); expect(pg.locator(".testresult")).to_be_visible(timeout=10000)
    print("      test result:", pg.inner_text(".testresult strong"))

    # gate sync on the flow page
    pg.goto(B + "/frontend-app/prod"); pg.wait_for_selector("#gate-confirm", timeout=10000)
    pg.fill("#gate-confirm", "prod"); pg.click("text=/Sync .* to prod/")
    expect(pg.get_by_role("heading", name="Open the gate")).to_have_count(0, timeout=10000); ok("gate opened by sync")

    # prod release with typed confirmation (prod job then runs, so the gate stays closed until Jenkins finishes)
    pg.goto(B + "/frontend-app/prod/releases"); pg.wait_for_selector("#rel-version")
    pg.fill("#rel-version", "v2.3.0"); pg.click("text=Create release")
    dlg = pg.get_by_role("dialog"); expect(dlg.get_by_role("button", name="Create release")).to_be_disabled()
    dlg.locator("#cd-word").fill("prod"); dlg.get_by_role("button", name="Create release").click()
    expect(pg.get_by_role("dialog")).to_have_count(0, timeout=8000); ok("prod release created after typing prod")
    expect(pg.locator(".release", has_text="v2.3.0")).to_be_visible(timeout=8000); ok("new tag listed")
    expect(pg.locator(".release", has_text="v2.3.0")).to_contain_text("Building", timeout=8000); ok("new tag shows Building while Jenkins runs")
    expect(pg.get_by_role("button", name="Roll back").first).to_be_disabled(); ok("rollback disabled while the prod job runs")

    # stress start / stop
    pg.goto(B + "/frontend-app/staging/stress"); pg.wait_for_selector("text=Start test")
    pg.click("text=Start test"); pg.get_by_role("dialog").get_by_role("button", name="Start test").click()
    expect(pg.get_by_role("button", name="Stop test")).to_be_visible(timeout=8000); ok("stress test running")
    pg.get_by_role("button", name="Stop test").click(); expect(pg.get_by_text("Put load on it")).to_be_visible(timeout=10000); ok("stress test stopped")

    # runs console
    pg.goto(B + "/frontend-app/staging/runs"); expect(pg.locator(".console")).to_contain_text("[Pipeline] stage", timeout=8000); ok("console streams Jenkins output")


    pg.click("text=Sign out"); pg.wait_for_selector("#login-title", timeout=5000); ok("sign out")
    print("page errors:", errs)
    b.close()
