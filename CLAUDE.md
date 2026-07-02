# histogram-widget - AI Assistant Guide

    ## Project: IOsense Platform Integration
    Framework: react | Template: nextjs

    ## MCP Tools (REQUIRED)

    ### IOsense SDK MCP
    - **ALWAYS use real IOsense data, never mock**
    - Login page → get accessToken → store in session
    - Use .env for username/password
    - Track API functionID calls in `iosense.md` file
    - Data types: devices (influx), assets, insights (bruce), enms, events

    ### Figma MCP  
    - If Figma link provided → use Figma MCP
    - Create dynamic apps, not static
    - Connect to IOsense SDK APIs

    ### Playwright SDK
    **Before claiming "working":**
    - [ ] Playwright test passes
    - [ ] Screenshots taken  
    - [ ] Console errors fixed
    - [ ] Real IOsense data confirmed
    - [ ] End-to-end test complete

    ## Code Rules
    1. **Modular code** - separate components
    2. **No hardcoded secrets** - use .env
    3. **Authentication first** - login before features
    4. **Error handling** - try/catch everything
    5. **Update iosense.md** - track API resource IDs

    ## File Structure
    ```
    src/
    ├── components/     # UI components
    ├── services/       # IOsense SDK calls
    ├── auth/          # Login/token management
    └── tests/         # Playwright tests
    iosense.md         # API tracking
    .env.example       # Config template
    ```

    ## AI Instructions
    - IOsense SDK > mock data (always)
    - Implement login first
    - Use Figma MCP when links provided
    - Run Playwright before saying "done"
    - Keep code modular and secure
    - Document API functionID calls in iosense.md

    ---
    *Build robust apps with IOsense platform integration*
    