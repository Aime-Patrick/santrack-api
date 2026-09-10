# Scripts

## traceability-walkthrough.mjs

Walks the whole MVP path from the architecture document against a running API:

    Manufacturer -> Warehouse -> Retailer -> Consumer, then a batch recall.

It creates its own throwaway organizations, products and identities on every
run, so it is safe to run repeatedly against a development database. It asserts
the business rules from section 14 rather than only checking status codes.

    # with the API running on the default port
    node scripts/traceability-walkthrough.mjs

    # against another instance
    API_BASE=http://localhost:8099 node scripts/traceability-walkthrough.mjs

Exit code is 0 when every check passes.
