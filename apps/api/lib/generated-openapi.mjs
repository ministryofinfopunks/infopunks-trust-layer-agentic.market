// AUTO-GENERATED FROM openapi.yaml. DO NOT EDIT BY HAND.
export const generatedOperationScopes = {
  "GET /healthz": null,
  "POST /v1/budget/quote": "read",
  "POST /v1/passports": "write",
  "GET /v1/passports/{subjectId}": "read",
  "POST /v1/passports/{subjectId}/rotate-key": "write",
  "POST /v1/evidence": "write",
  "POST /v1/disputes/evaluate": "write",
  "POST /v1/trust/resolve": "write",
  "POST /v1/routing/select-validator": "write",
  "POST /v1/routing/select-executor": "write",
  "GET /v1/events/stream": "read",
  "POST /v1/webhooks": "write",
  "POST /v1/portability/export": "read",
  "POST /v1/portability/import": "write",
  "POST /v1/economic/escrow-quote": "read",
  "POST /v1/economic/risk-price": "read",
  "POST /v1/economic/attestation-bundle": "read",
  "GET /v1/traces/{traceId}": "read",
  "GET /v1/trust/{subjectId}/explain": "read",
  "GET /v1/prompts/{name}": "read",
  "GET /v1/war-room/state": "read",
  "POST /v1/sim/run": "write"
};

export const generatedRequestSchemas = {
  "BudgetQuoteRequest": {
    "kind": "object",
    "shape": {
      "operation": {
        "kind": "enum",
        "values": [
          "trust.resolve",
          "routing.select_validator",
          "routing.select_executor",
          "traces.get",
          "trust.explain",
          "disputes.evaluate"
        ]
      },
      "subject_id": {
        "kind": "optional",
        "schema": {
          "kind": "string"
        }
      },
      "context": {
        "kind": "optional",
        "schema": {
          "kind": "object",
          "shape": {
            "task_type": {
              "kind": "optional",
              "schema": {
                "kind": "string"
              }
            },
            "domain": {
              "kind": "optional",
              "schema": {
                "kind": "string"
              }
            },
            "risk_level": {
              "kind": "optional",
              "schema": {
                "kind": "enum",
                "values": [
                  "low",
                  "medium",
                  "high"
                ]
              }
            },
            "requires_validation": {
              "kind": "optional",
              "schema": {
                "kind": "boolean"
              }
            }
          },
          "allowUnknown": true
        }
      },
      "response_mode": {
        "kind": "optional",
        "schema": {
          "kind": "enum",
          "values": [
            "minimal",
            "standard",
            "explain",
            "audit"
          ]
        }
      },
      "evidence_window": {
        "kind": "optional",
        "schema": {
          "kind": "integer",
          "min": 1,
          "max": 200
        }
      },
      "budget_cap_units": {
        "kind": "optional",
        "schema": {
          "kind": "number",
          "min": 0
        }
      }
    },
    "allowUnknown": false
  },
  "PassportCreateRequest": {
    "kind": "object",
    "shape": {
      "subject_id": {
        "kind": "string"
      },
      "subject_type": {
        "kind": "enum",
        "values": [
          "agent",
          "validator",
          "operator_service",
          "tool_adapter"
        ]
      },
      "did": {
        "kind": "optional",
        "schema": {
          "kind": "string"
        }
      },
      "issuer": {
        "kind": "optional",
        "schema": {
          "kind": "object",
          "shape": {
            "issuer_id": {
              "kind": "string"
            },
            "signature": {
              "kind": "string"
            },
            "provenance": {
              "kind": "object",
              "shape": {
                "trust_anchor": {
                  "kind": "string"
                },
                "verification_method": {
                  "kind": "string"
                },
                "issued_at": {
                  "kind": "string"
                }
              },
              "allowUnknown": false
            }
          },
          "allowUnknown": false
        }
      },
      "public_keys": {
        "kind": "array",
        "item": {
          "kind": "object",
          "shape": {
            "kid": {
              "kind": "string"
            },
            "alg": {
              "kind": "string"
            },
            "public_key": {
              "kind": "string"
            }
          },
          "allowUnknown": false
        },
        "minLength": 1
      },
      "capabilities": {
        "kind": "array",
        "item": {
          "kind": "object",
          "shape": {
            "name": {
              "kind": "string"
            },
            "version": {
              "kind": "string"
            },
            "verified": {
              "kind": "boolean"
            }
          },
          "allowUnknown": false
        }
      },
      "reputation_scope_defaults": {
        "kind": "optional",
        "schema": {
          "kind": "object",
          "shape": {
            "domains": {
              "kind": "array",
              "item": {
                "kind": "string"
              }
            },
            "risk_tolerance": {
              "kind": "enum",
              "values": [
                "low",
                "medium",
                "high"
              ]
            }
          },
          "allowUnknown": false
        }
      },
      "metadata": {
        "kind": "optional",
        "schema": {
          "kind": "object",
          "shape": {},
          "allowUnknown": true
        }
      }
    },
    "allowUnknown": false
  },
  "PassportRotateKeyRequest": {
    "kind": "object",
    "shape": {
      "key": {
        "kind": "object",
        "shape": {
          "kid": {
            "kind": "string"
          },
          "alg": {
            "kind": "string"
          },
          "public_key": {
            "kind": "string"
          }
        },
        "allowUnknown": false
      },
      "reason": {
        "kind": "optional",
        "schema": {
          "kind": "string"
        }
      }
    },
    "allowUnknown": false
  },
  "EvidenceCreateRequest": {
    "kind": "object",
    "shape": {
      "subject_id": {
        "kind": "string"
      },
      "event_type": {
        "kind": "enum",
        "values": [
          "task.completed",
          "task.failed",
          "task.timeout",
          "validation.passed",
          "validation.failed",
          "validation.reversed",
          "dispute.opened",
          "dispute.resolved",
          "route.selected",
          "route.blocked",
          "collusion.suspected",
          "passport.revoked"
        ]
      },
      "task_id": {
        "kind": "optional",
        "schema": {
          "kind": "string"
        }
      },
      "context": {
        "kind": "object",
        "shape": {
          "task_type": {
            "kind": "optional",
            "schema": {
              "kind": "string"
            }
          },
          "domain": {
            "kind": "optional",
            "schema": {
              "kind": "string"
            }
          },
          "risk_level": {
            "kind": "optional",
            "schema": {
              "kind": "enum",
              "values": [
                "low",
                "medium",
                "high"
              ]
            }
          },
          "requires_validation": {
            "kind": "optional",
            "schema": {
              "kind": "boolean"
            }
          }
        },
        "allowUnknown": true
      },
      "outcome": {
        "kind": "object",
        "shape": {
          "status": {
            "kind": "optional",
            "schema": {
              "kind": "string"
            }
          },
          "latency_ms": {
            "kind": "optional",
            "schema": {
              "kind": "number",
              "min": 0
            }
          },
          "cost_usd": {
            "kind": "optional",
            "schema": {
              "kind": "number",
              "min": 0
            }
          },
          "quality_score": {
            "kind": "optional",
            "schema": {
              "kind": "number",
              "min": 0,
              "max": 1
            }
          },
          "confidence_score": {
            "kind": "optional",
            "schema": {
              "kind": "number",
              "min": 0,
              "max": 1
            }
          }
        },
        "allowUnknown": true
      },
      "validators": {
        "kind": "optional",
        "schema": {
          "kind": "array",
          "item": {
            "kind": "object",
            "shape": {
              "validator_id": {
                "kind": "string"
              },
              "verdict": {
                "kind": "enum",
                "values": [
                  "pass",
                  "fail",
                  "abstain"
                ]
              },
              "weight": {
                "kind": "number",
                "min": 0,
                "max": 1
              },
              "reason_codes": {
                "kind": "array",
                "item": {
                  "kind": "string"
                }
              }
            },
            "allowUnknown": false
          }
        }
      },
      "disputes": {
        "kind": "optional",
        "schema": {
          "kind": "array",
          "item": {
            "kind": "object",
            "shape": {},
            "allowUnknown": true
          }
        }
      },
      "provenance": {
        "kind": "optional",
        "schema": {
          "kind": "object",
          "shape": {},
          "allowUnknown": true
        }
      }
    },
    "allowUnknown": false
  },
  "DisputeEvaluateRequest": {
    "kind": "object",
    "shape": {
      "subject_id": {
        "kind": "string"
      },
      "task_id": {
        "kind": "optional",
        "schema": {
          "kind": "string"
        }
      },
      "evidence_ids": {
        "kind": "array",
        "item": {
          "kind": "string"
        },
        "minLength": 1,
        "maxLength": 25
      },
      "context": {
        "kind": "object",
        "shape": {
          "task_type": {
            "kind": "optional",
            "schema": {
              "kind": "string"
            }
          },
          "domain": {
            "kind": "optional",
            "schema": {
              "kind": "string"
            }
          },
          "risk_level": {
            "kind": "optional",
            "schema": {
              "kind": "enum",
              "values": [
                "low",
                "medium",
                "high"
              ]
            }
          },
          "requires_validation": {
            "kind": "optional",
            "schema": {
              "kind": "boolean"
            }
          }
        },
        "allowUnknown": true
      },
      "reason_code": {
        "kind": "string"
      },
      "severity": {
        "kind": "enum",
        "values": [
          "low",
          "medium",
          "high",
          "critical"
        ]
      },
      "preferred_resolution": {
        "kind": "optional",
        "schema": {
          "kind": "enum",
          "values": [
            "uphold_current_trust",
            "request_additional_validation",
            "reverse_validation_credit",
            "quarantine_subject"
          ]
        }
      },
      "disputed_by": {
        "kind": "optional",
        "schema": {
          "kind": "string"
        }
      },
      "notes": {
        "kind": "optional",
        "schema": {
          "kind": "string"
        }
      }
    },
    "allowUnknown": false
  },
  "TrustResolveRequest": {
    "kind": "object",
    "shape": {
      "subject_id": {
        "kind": "string"
      },
      "context": {
        "kind": "object",
        "shape": {
          "task_type": {
            "kind": "optional",
            "schema": {
              "kind": "string"
            }
          },
          "domain": {
            "kind": "optional",
            "schema": {
              "kind": "string"
            }
          },
          "risk_level": {
            "kind": "optional",
            "schema": {
              "kind": "enum",
              "values": [
                "low",
                "medium",
                "high"
              ]
            }
          },
          "requires_validation": {
            "kind": "optional",
            "schema": {
              "kind": "boolean"
            }
          }
        },
        "allowUnknown": true
      },
      "policy_id": {
        "kind": "optional",
        "schema": {
          "kind": "string"
        }
      },
      "policy_version": {
        "kind": "optional",
        "schema": {
          "kind": "string"
        }
      },
      "include": {
        "kind": "optional",
        "schema": {
          "kind": "array",
          "item": {
            "kind": "string"
          }
        }
      },
      "response_mode": {
        "kind": "optional",
        "schema": {
          "kind": "enum",
          "values": [
            "minimal",
            "standard",
            "explain",
            "audit"
          ]
        }
      },
      "candidate_validators": {
        "kind": "optional",
        "schema": {
          "kind": "array",
          "item": {
            "kind": "string"
          }
        }
      }
    },
    "allowUnknown": false
  },
  "RoutingSelectValidatorRequest": {
    "kind": "object",
    "shape": {
      "task_id": {
        "kind": "optional",
        "schema": {
          "kind": "string"
        }
      },
      "subject_id": {
        "kind": "string"
      },
      "candidates": {
        "kind": "array",
        "item": {
          "kind": "string"
        },
        "minLength": 1
      },
      "context": {
        "kind": "object",
        "shape": {
          "task_type": {
            "kind": "optional",
            "schema": {
              "kind": "string"
            }
          },
          "domain": {
            "kind": "optional",
            "schema": {
              "kind": "string"
            }
          },
          "risk_level": {
            "kind": "optional",
            "schema": {
              "kind": "enum",
              "values": [
                "low",
                "medium",
                "high"
              ]
            }
          },
          "requires_validation": {
            "kind": "optional",
            "schema": {
              "kind": "boolean"
            }
          }
        },
        "allowUnknown": true
      },
      "minimum_count": {
        "kind": "optional",
        "schema": {
          "kind": "integer",
          "min": 1
        }
      },
      "quorum_policy": {
        "kind": "optional",
        "schema": {
          "kind": "object",
          "shape": {
            "mode": {
              "kind": "enum",
              "values": [
                "minimum",
                "majority",
                "threshold"
              ]
            },
            "required_count": {
              "kind": "optional",
              "schema": {
                "kind": "integer",
                "min": 1
              }
            },
            "consensus_threshold": {
              "kind": "optional",
              "schema": {
                "kind": "number",
                "min": 0,
                "max": 1
              }
            },
            "escalation_action": {
              "kind": "optional",
              "schema": {
                "kind": "enum",
                "values": [
                  "additional_validators",
                  "reroute_execution",
                  "manual_review"
                ]
              }
            }
          },
          "allowUnknown": false
        }
      }
    },
    "allowUnknown": false
  },
  "RoutingSelectExecutorRequest": {
    "kind": "object",
    "shape": {
      "task_id": {
        "kind": "optional",
        "schema": {
          "kind": "string"
        }
      },
      "subject_id": {
        "kind": "string"
      },
      "candidates": {
        "kind": "array",
        "item": {
          "kind": "string"
        },
        "minLength": 1
      },
      "context": {
        "kind": "object",
        "shape": {
          "task_type": {
            "kind": "optional",
            "schema": {
              "kind": "string"
            }
          },
          "domain": {
            "kind": "optional",
            "schema": {
              "kind": "string"
            }
          },
          "risk_level": {
            "kind": "optional",
            "schema": {
              "kind": "enum",
              "values": [
                "low",
                "medium",
                "high"
              ]
            }
          },
          "requires_validation": {
            "kind": "optional",
            "schema": {
              "kind": "boolean"
            }
          }
        },
        "allowUnknown": true
      },
      "minimum_count": {
        "kind": "optional",
        "schema": {
          "kind": "integer",
          "min": 1
        }
      },
      "maximum_cost_usd": {
        "kind": "optional",
        "schema": {
          "kind": "number",
          "min": 0
        }
      },
      "allow_autonomy_downgrade": {
        "kind": "optional",
        "schema": {
          "kind": "boolean"
        }
      }
    },
    "allowUnknown": false
  },
  "WebhookCreateRequest": {
    "kind": "object",
    "shape": {
      "url": {
        "kind": "string"
      },
      "secret": {
        "kind": "string",
        "minLength": 8
      },
      "event_types": {
        "kind": "array",
        "item": {
          "kind": "string"
        },
        "minLength": 1
      },
      "subjects": {
        "kind": "optional",
        "schema": {
          "kind": "array",
          "item": {
            "kind": "string"
          }
        }
      },
      "max_attempts": {
        "kind": "optional",
        "schema": {
          "kind": "integer",
          "min": 1,
          "max": 8
        }
      }
    },
    "allowUnknown": false
  },
  "PortabilityExportRequest": {
    "kind": "object",
    "shape": {
      "subject_id": {
        "kind": "string"
      },
      "include_evidence": {
        "kind": "optional",
        "schema": {
          "kind": "boolean"
        }
      },
      "evidence_limit": {
        "kind": "optional",
        "schema": {
          "kind": "integer",
          "min": 1,
          "max": 200
        }
      },
      "include_trace_ids": {
        "kind": "optional",
        "schema": {
          "kind": "boolean"
        }
      },
      "target_network": {
        "kind": "optional",
        "schema": {
          "kind": "string"
        }
      }
    },
    "allowUnknown": false
  },
  "PortabilityImportRequest": {
    "kind": "object",
    "shape": {
      "bundle": {
        "kind": "object",
        "shape": {
          "resource_type": {
            "kind": "enum",
            "values": [
              "trust_portability_bundle"
            ]
          },
          "format_version": {
            "kind": "string"
          },
          "source_environment": {
            "kind": "string"
          },
          "exported_at": {
            "kind": "string"
          },
          "subject": {
            "kind": "object",
            "shape": {
              "passport_id": {
                "kind": "string"
              },
              "subject_id": {
                "kind": "string"
              },
              "status": {
                "kind": "enum",
                "values": [
                  "active"
                ]
              },
              "issuer": {
                "kind": "object",
                "shape": {
                  "issuer_id": {
                    "kind": "string"
                  },
                  "signature": {
                    "kind": "string"
                  },
                  "provenance": {
                    "kind": "object",
                    "shape": {
                      "trust_anchor": {
                        "kind": "string"
                      },
                      "verification_method": {
                        "kind": "string"
                      },
                      "issued_at": {
                        "kind": "string"
                      }
                    },
                    "allowUnknown": false
                  }
                },
                "allowUnknown": false
              },
              "created_at": {
                "kind": "string"
              },
              "response_cost": {
                "kind": "optional",
                "schema": {
                  "kind": "object",
                  "shape": {
                    "compute_units": {
                      "kind": "number"
                    },
                    "estimated_tokens": {
                      "kind": "integer"
                    },
                    "estimated_cost_usd": {
                      "kind": "number"
                    },
                    "response_bytes": {
                      "kind": "integer"
                    },
                    "preset": {
                      "kind": "enum",
                      "values": [
                        "minimal",
                        "standard",
                        "explain",
                        "audit"
                      ]
                    }
                  },
                  "allowUnknown": false
                }
              },
              "budget_hints": {
                "kind": "optional",
                "schema": {
                  "kind": "object",
                  "shape": {
                    "recommended_response_mode": {
                      "kind": "enum",
                      "values": [
                        "minimal",
                        "standard",
                        "explain",
                        "audit"
                      ]
                    },
                    "recommended_cache_ttl_s": {
                      "kind": "integer"
                    },
                    "budget_remaining_units": {
                      "kind": "number"
                    },
                    "budget_status": {
                      "kind": "enum",
                      "values": [
                        "healthy",
                        "watch",
                        "constrained"
                      ]
                    }
                  },
                  "allowUnknown": false
                }
              },
              "subject_type": {
                "kind": "enum",
                "values": [
                  "agent",
                  "validator",
                  "operator_service",
                  "tool_adapter"
                ]
              },
              "did": {
                "kind": "string",
                "nullable": true
              },
              "public_keys": {
                "kind": "array",
                "item": {
                  "kind": "object",
                  "shape": {
                    "kid": {
                      "kind": "string"
                    },
                    "alg": {
                      "kind": "string"
                    },
                    "public_key": {
                      "kind": "string"
                    }
                  },
                  "allowUnknown": false
                }
              },
              "capabilities": {
                "kind": "array",
                "item": {
                  "kind": "object",
                  "shape": {
                    "name": {
                      "kind": "string"
                    },
                    "version": {
                      "kind": "string"
                    },
                    "verified": {
                      "kind": "boolean"
                    }
                  },
                  "allowUnknown": false
                }
              },
              "reputation_scope_defaults": {
                "kind": "object",
                "shape": {
                  "domains": {
                    "kind": "array",
                    "item": {
                      "kind": "string"
                    }
                  },
                  "risk_tolerance": {
                    "kind": "enum",
                    "values": [
                      "low",
                      "medium",
                      "high"
                    ]
                  }
                },
                "allowUnknown": false
              },
              "lifecycle": {
                "kind": "object",
                "shape": {
                  "status": {
                    "kind": "enum",
                    "values": [
                      "active",
                      "suspended",
                      "revoked"
                    ]
                  },
                  "status_reason": {
                    "kind": "string",
                    "nullable": true
                  },
                  "last_status_change_at": {
                    "kind": "string"
                  },
                  "last_key_rotation_at": {
                    "kind": "string",
                    "nullable": true
                  },
                  "key_count": {
                    "kind": "integer"
                  }
                },
                "allowUnknown": false
              },
              "portability": {
                "kind": "object",
                "shape": {
                  "portable_format": {
                    "kind": "string"
                  },
                  "exportable": {
                    "kind": "boolean"
                  },
                  "scope_defaults_included": {
                    "kind": "boolean"
                  },
                  "issuer_attested": {
                    "kind": "boolean"
                  }
                },
                "allowUnknown": false
              },
              "metadata": {
                "kind": "object",
                "shape": {},
                "allowUnknown": true
              },
              "updated_at": {
                "kind": "string"
              }
            },
            "allowUnknown": false
          },
          "snapshot": {
            "kind": "object",
            "shape": {},
            "allowUnknown": true
          },
          "evidence": {
            "kind": "array",
            "item": {
              "kind": "object",
              "shape": {},
              "allowUnknown": true
            }
          },
          "trace_refs": {
            "kind": "array",
            "item": {
              "kind": "string"
            }
          },
          "receipt": {
            "kind": "object",
            "shape": {
              "receipt_id": {
                "kind": "string"
              },
              "subject_id": {
                "kind": "string"
              },
              "source_environment": {
                "kind": "string"
              },
              "target_network": {
                "kind": "string"
              },
              "signature": {
                "kind": "string"
              },
              "signed_fields": {
                "kind": "array",
                "item": {
                  "kind": "string"
                }
              }
            },
            "allowUnknown": false
          },
          "response_cost": {
            "kind": "optional",
            "schema": {
              "kind": "object",
              "shape": {
                "compute_units": {
                  "kind": "number"
                },
                "estimated_tokens": {
                  "kind": "integer"
                },
                "estimated_cost_usd": {
                  "kind": "number"
                },
                "response_bytes": {
                  "kind": "integer"
                },
                "preset": {
                  "kind": "enum",
                  "values": [
                    "minimal",
                    "standard",
                    "explain",
                    "audit"
                  ]
                }
              },
              "allowUnknown": false
            }
          },
          "budget_hints": {
            "kind": "optional",
            "schema": {
              "kind": "object",
              "shape": {
                "recommended_response_mode": {
                  "kind": "enum",
                  "values": [
                    "minimal",
                    "standard",
                    "explain",
                    "audit"
                  ]
                },
                "recommended_cache_ttl_s": {
                  "kind": "integer"
                },
                "budget_remaining_units": {
                  "kind": "number"
                },
                "budget_status": {
                  "kind": "enum",
                  "values": [
                    "healthy",
                    "watch",
                    "constrained"
                  ]
                }
              },
              "allowUnknown": false
            }
          }
        },
        "allowUnknown": false
      },
      "import_mode": {
        "kind": "optional",
        "schema": {
          "kind": "enum",
          "values": [
            "merge",
            "mirror"
          ]
        }
      }
    },
    "allowUnknown": false
  },
  "EscrowQuoteRequest": {
    "kind": "object",
    "shape": {
      "subject_id": {
        "kind": "string"
      },
      "task_id": {
        "kind": "optional",
        "schema": {
          "kind": "string"
        }
      },
      "context": {
        "kind": "object",
        "shape": {
          "task_type": {
            "kind": "optional",
            "schema": {
              "kind": "string"
            }
          },
          "domain": {
            "kind": "optional",
            "schema": {
              "kind": "string"
            }
          },
          "risk_level": {
            "kind": "optional",
            "schema": {
              "kind": "enum",
              "values": [
                "low",
                "medium",
                "high"
              ]
            }
          },
          "requires_validation": {
            "kind": "optional",
            "schema": {
              "kind": "boolean"
            }
          }
        },
        "allowUnknown": true
      },
      "notional_usd": {
        "kind": "number",
        "min": 0
      }
    },
    "allowUnknown": false
  },
  "RiskPriceRequest": {
    "kind": "object",
    "shape": {
      "subject_id": {
        "kind": "string"
      },
      "context": {
        "kind": "object",
        "shape": {
          "task_type": {
            "kind": "optional",
            "schema": {
              "kind": "string"
            }
          },
          "domain": {
            "kind": "optional",
            "schema": {
              "kind": "string"
            }
          },
          "risk_level": {
            "kind": "optional",
            "schema": {
              "kind": "enum",
              "values": [
                "low",
                "medium",
                "high"
              ]
            }
          },
          "requires_validation": {
            "kind": "optional",
            "schema": {
              "kind": "boolean"
            }
          }
        },
        "allowUnknown": true
      },
      "notional_usd": {
        "kind": "optional",
        "schema": {
          "kind": "number",
          "min": 0
        }
      },
      "duration_hours": {
        "kind": "optional",
        "schema": {
          "kind": "integer",
          "min": 1
        }
      }
    },
    "allowUnknown": false
  },
  "AttestationBundleRequest": {
    "kind": "object",
    "shape": {
      "subject_id": {
        "kind": "string"
      },
      "context": {
        "kind": "object",
        "shape": {
          "task_type": {
            "kind": "optional",
            "schema": {
              "kind": "string"
            }
          },
          "domain": {
            "kind": "optional",
            "schema": {
              "kind": "string"
            }
          },
          "risk_level": {
            "kind": "optional",
            "schema": {
              "kind": "enum",
              "values": [
                "low",
                "medium",
                "high"
              ]
            }
          },
          "requires_validation": {
            "kind": "optional",
            "schema": {
              "kind": "boolean"
            }
          }
        },
        "allowUnknown": true
      },
      "include_recent_evidence": {
        "kind": "optional",
        "schema": {
          "kind": "boolean"
        }
      },
      "evidence_limit": {
        "kind": "optional",
        "schema": {
          "kind": "integer",
          "min": 1,
          "max": 50
        }
      }
    },
    "allowUnknown": false
  },
  "SimRunRequest": {
    "kind": "object",
    "shape": {
      "scenario": {
        "kind": "optional",
        "schema": {
          "kind": "string"
        }
      },
      "domain_mix": {
        "kind": "optional",
        "schema": {
          "kind": "array",
          "item": {
            "kind": "string"
          }
        }
      },
      "number_of_agents": {
        "kind": "optional",
        "schema": {
          "kind": "integer",
          "min": 1
        }
      },
      "number_of_validators": {
        "kind": "optional",
        "schema": {
          "kind": "integer",
          "min": 1
        }
      },
      "failure_rate": {
        "kind": "optional",
        "schema": {
          "kind": "number",
          "min": 0,
          "max": 1
        }
      },
      "collusion_probability": {
        "kind": "optional",
        "schema": {
          "kind": "number",
          "min": 0,
          "max": 1
        }
      },
      "reversal_probability": {
        "kind": "optional",
        "schema": {
          "kind": "number",
          "min": 0,
          "max": 1
        }
      }
    },
    "allowUnknown": false
  }
};
