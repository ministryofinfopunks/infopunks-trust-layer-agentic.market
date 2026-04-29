export async function authorizePaidCall({
  entitlementService,
  operation,
  args,
  callerSubjectId,
  adapterTraceId,
  entitlement,
  requestGuard = null
}) {
  return entitlementService.authorizeAndBill({
    operation,
    payment: args.payment,
    fallbackPayer: callerSubjectId,
    spendLimitUnits: args.spend_limit_units,
    adapterTraceId,
    entitlement,
    requestGuard,
    subjectId: args.subject_id ?? null
  });
}
