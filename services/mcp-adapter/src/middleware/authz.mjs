export async function authorizePaidCall({
  entitlementService,
  operation,
  args,
  callerSubjectId,
  adapterTraceId,
  entitlement
}) {
  return entitlementService.authorizeAndBill({
    operation,
    payment: args.payment,
    fallbackPayer: callerSubjectId,
    spendLimitUnits: args.spend_limit_units,
    adapterTraceId,
    entitlement
  });
}
