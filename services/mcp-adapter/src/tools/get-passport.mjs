export async function getPassportTool({ args, subjectResolution, adapterTraceId }) {
  if (args.subject_id) {
    const target = await subjectResolution.resolveTarget(
      args.subject_id,
      { createIfMissing: Boolean(args.create_if_missing) },
      adapterTraceId
    );
    return {
      subject_id: target.subject_id,
      passport_id: target.passport?.passport_id ?? null,
      status: target.passport?.status ?? null,
      created: target.created
    };
  }

  const caller = await subjectResolution.resolveCaller(
    args.agent ?? {},
    undefined,
    adapterTraceId
  );
  return {
    subject_id: caller.subject_id,
    passport_id: caller.passport?.passport_id ?? null,
    status: caller.passport?.status ?? null,
    created: caller.created
  };
}
