export interface ValidationIssue {
  path: string;
  message: string;
}

function formatValidationIssues(issues: ValidationIssue[]): string {
  const lines = ["Invalid Kino composition", ""];
  for (const issue of issues) {
    lines.push(issue.path);
    lines.push(`  ${issue.message}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export class KinoValidationError extends Error {
  public readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super(formatValidationIssues(issues));
    this.name = "KinoValidationError";
    this.issues = issues;
  }
}

function isFiniteNumber(val: unknown): val is number {
  return typeof val === "number" && Number.isFinite(val);
}

function isInteger(val: unknown): val is number {
  return isFiniteNumber(val) && Number.isInteger(val);
}

function isNonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim().length > 0;
}

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

export function validateComposition(comp: unknown): void {
  const issues: ValidationIssue[] = [];

  if (!isObject(comp)) {
    throw new KinoValidationError([
      {
        path: "composition",
        message: `Expected a KinoComposition object, received ${comp === null ? "null" : Array.isArray(comp) ? "array" : typeof comp}`,
      },
    ]);
  }

  // Top-level properties
  if (comp.width !== undefined) {
    if (!isInteger(comp.width) || comp.width <= 0) {
      issues.push({
        path: "width",
        message: `Expected a positive integer, received ${comp.width}`,
      });
    }
  }

  if (comp.height !== undefined) {
    if (!isInteger(comp.height) || comp.height <= 0) {
      issues.push({
        path: "height",
        message: `Expected a positive integer, received ${comp.height}`,
      });
    }
  }

  if (comp.fps !== undefined) {
    if (!isFiniteNumber(comp.fps) || comp.fps <= 0) {
      issues.push({
        path: "fps",
        message: `Expected a positive number, received ${comp.fps}`,
      });
    }
  }

  if (!Array.isArray(comp.scenes) || comp.scenes.length === 0) {
    issues.push({
      path: "scenes",
      message: "Expected a non-empty array of scenes",
    });
    // Stop early if scenes array is invalid
    throw new KinoValidationError(issues);
  }

  const VALID_TRANSITION_TYPES = [
    "fade",
    "slideLeft",
    "slideRight",
    "slideUp",
    "slideDown",
    "wipeLeft",
    "wipeRight",
    "wipeUp",
    "wipeDown",
    "zoomIn",
    "zoomOut",
  ];

  // Validate Scenes
  comp.scenes.forEach((scene: unknown, sIdx: number) => {
    const scenePath = `scenes[${sIdx}]`;

    if (!isObject(scene)) {
      issues.push({
        path: scenePath,
        message: `Expected a scene object, received ${typeof scene}`,
      });
      return;
    }

    if (!isFiniteNumber(scene.duration) || scene.duration <= 0) {
      issues.push({
        path: `${scenePath}.duration`,
        message: `Expected a positive number, received ${scene.duration}`,
      });
    }

    // Transition validation
    if (scene.transition !== undefined) {
      const transPath = `${scenePath}.transition`;
      if (sIdx === 0) {
        issues.push({
          path: transPath,
          message: "First scene cannot define a transition",
        });
      } else if (!isObject(scene.transition)) {
        issues.push({
          path: transPath,
          message: `Expected a transition object, received ${typeof scene.transition}`,
        });
      } else {
        const trans = scene.transition;
        if (!isNonEmptyString(trans.type) || !VALID_TRANSITION_TYPES.includes(trans.type as string)) {
          issues.push({
            path: `${transPath}.type`,
            message: `Expected one of ${VALID_TRANSITION_TYPES.map((t) => JSON.stringify(t)).join(", ")}, received ${JSON.stringify(trans.type)}`,
          });
        }

        if (!isFiniteNumber(trans.duration) || trans.duration <= 0) {
          issues.push({
            path: `${transPath}.duration`,
            message: `Expected a positive number, received ${trans.duration}`,
          });
        } else {
          const scenesArr = comp.scenes as any[];
          const prevScene = scenesArr[sIdx - 1];
          const prevDur = isObject(prevScene) && isFiniteNumber(prevScene.duration) ? prevScene.duration : 0;
          const currDur = isFiniteNumber(scene.duration) ? scene.duration : 0;

          if (trans.duration > prevDur || trans.duration > currDur) {
            issues.push({
              path: `${transPath}.duration`,
              message: `Transition duration (${trans.duration}s) must not exceed adjacent scene durations (prev: ${prevDur}s, curr: ${currDur}s)`,
            });
          }
        }
      }
    }

    // Background validation
    if (scene.background !== undefined) {
      const bgPath = `${scenePath}.background`;
      if (typeof scene.background === "string") {
        if (!isNonEmptyString(scene.background)) {
          issues.push({
            path: bgPath,
            message: "Expected a non-empty color string",
          });
        }
      } else if (isObject(scene.background)) {
        const bg = scene.background;
        if (bg.type === "color") {
          if (!isNonEmptyString(bg.value)) {
            issues.push({
              path: `${bgPath}.value`,
              message: "Expected a non-empty color string",
            });
          }
        } else if (bg.type === "gradient") {
          if (!isNonEmptyString(bg.from)) {
            issues.push({
              path: `${bgPath}.from`,
              message: "Expected a non-empty color string",
            });
          }
          if (!isNonEmptyString(bg.to)) {
            issues.push({
              path: `${bgPath}.to`,
              message: "Expected a non-empty color string",
            });
          }
          if (bg.direction !== undefined && bg.direction !== "horizontal" && bg.direction !== "vertical") {
            issues.push({
              path: `${bgPath}.direction`,
              message: `Expected "horizontal" or "vertical", received ${JSON.stringify(bg.direction)}`,
            });
          }
        } else if (bg.type === "image" || bg.type === "video") {
          if (!isNonEmptyString(bg.src)) {
            issues.push({
              path: `${bgPath}.src`,
              message: `Expected a non-empty file path or URL for ${bg.type} background`,
            });
          }
        } else {
          issues.push({
            path: `${bgPath}.type`,
            message: `Expected "color", "gradient", "image", or "video", received ${JSON.stringify(bg.type)}`,
          });
        }
      } else {
        issues.push({
          path: bgPath,
          message: "Expected a string or background object",
        });
      }
    }

    // Elements validation
    if (scene.elements !== undefined) {
      if (!Array.isArray(scene.elements)) {
        issues.push({
          path: `${scenePath}.elements`,
          message: "Expected an array of elements",
        });
      } else {
        scene.elements.forEach((elem: unknown, eIdx: number) => {
          const elemPath = `${scenePath}.elements[${eIdx}]`;

          if (!isObject(elem)) {
            issues.push({
              path: elemPath,
              message: `Expected an element object, received ${typeof elem}`,
            });
            return;
          }

          const startVal = elem.startAt !== undefined ? elem.startAt : elem.startTime;
          const startPropName = elem.startAt !== undefined ? "startAt" : "startTime";
          if (startVal !== undefined) {
            if (!isFiniteNumber(startVal) || startVal < 0) {
              issues.push({
                path: `${elemPath}.${startPropName}`,
                message: `Expected a non-negative number, received ${startVal}`,
              });
            }
          }

          if (elem.duration !== undefined) {
            if (!isFiniteNumber(elem.duration) || elem.duration <= 0) {
              issues.push({
                path: `${elemPath}.duration`,
                message: `Expected a positive number, received ${elem.duration}`,
              });
            }
          }

          if (elem.zIndex !== undefined) {
            if (!isFiniteNumber(elem.zIndex)) {
              issues.push({
                path: `${elemPath}.zIndex`,
                message: `Expected a finite number, received ${elem.zIndex}`,
              });
            }
          }

          const elemType = elem.type ?? "text";

          if (elemType === "image") {
            if (!isNonEmptyString(elem.src)) {
              issues.push({
                path: `${elemPath}.src`,
                message: `Expected a non-empty file path or URL for image element`,
              });
            }

            if (elem.width !== undefined) {
              if (!isFiniteNumber(elem.width) || elem.width <= 0) {
                issues.push({
                  path: `${elemPath}.width`,
                  message: `Expected a positive number, received ${elem.width}`,
                });
              }
            }

            if (elem.height !== undefined) {
              if (!isFiniteNumber(elem.height) || elem.height <= 0) {
                issues.push({
                  path: `${elemPath}.height`,
                  message: `Expected a positive number, received ${elem.height}`,
                });
              }
            }

            if (elem.fit !== undefined) {
              const validFits = ["contain", "cover", "fill", "none"];
              if (typeof elem.fit !== "string" || !validFits.includes(elem.fit)) {
                issues.push({
                  path: `${elemPath}.fit`,
                  message: `Expected "contain", "cover", "fill", or "none", received ${JSON.stringify(elem.fit)}`,
                });
              }
            }
          } else if (elemType === "video") {
            if (!isNonEmptyString(elem.src)) {
              issues.push({
                path: `${elemPath}.src`,
                message: `Expected a non-empty file path or URL for video element`,
              });
            }

            if (elem.width !== undefined) {
              if (!isFiniteNumber(elem.width) || elem.width <= 0) {
                issues.push({
                  path: `${elemPath}.width`,
                  message: `Expected a positive number, received ${elem.width}`,
                });
              }
            }

            if (elem.height !== undefined) {
              if (!isFiniteNumber(elem.height) || elem.height <= 0) {
                issues.push({
                  path: `${elemPath}.height`,
                  message: `Expected a positive number, received ${elem.height}`,
                });
              }
            }

            if (elem.fit !== undefined) {
              const validFits = ["contain", "cover", "fill", "none"];
              if (typeof elem.fit !== "string" || !validFits.includes(elem.fit)) {
                issues.push({
                  path: `${elemPath}.fit`,
                  message: `Expected "contain", "cover", "fill", or "none", received ${JSON.stringify(elem.fit)}`,
                });
              }
            }

            if (elem.trimStart !== undefined) {
              if (!isFiniteNumber(elem.trimStart) || elem.trimStart < 0) {
                issues.push({
                  path: `${elemPath}.trimStart`,
                  message: `Expected a non-negative number, received ${elem.trimStart}`,
                });
              }
            }

            if (elem.loop !== undefined) {
              if (typeof elem.loop !== "boolean") {
                issues.push({
                  path: `${elemPath}.loop`,
                  message: `Expected a boolean, received ${typeof elem.loop}`,
                });
              }
            }

            if (elem.volume !== undefined) {
              if (!isFiniteNumber(elem.volume) || elem.volume < 0) {
                issues.push({
                  path: `${elemPath}.volume`,
                  message: `Expected a non-negative number, received ${elem.volume}`,
                });
              }
            }
          } else if (elemType === "text") {
            if (elem.content !== undefined && typeof elem.content !== "string") {
              issues.push({
                path: `${elemPath}.content`,
                message: `Expected a string, received ${typeof elem.content}`,
              });
            }

            if (elem.fontSize !== undefined) {
              if (!isFiniteNumber(elem.fontSize) || elem.fontSize <= 0) {
                issues.push({
                  path: `${elemPath}.fontSize`,
                  message: `Expected a positive number, received ${elem.fontSize}`,
                });
              }
            }

            if (elem.fontColor !== undefined) {
              if (!isNonEmptyString(elem.fontColor)) {
                issues.push({
                  path: `${elemPath}.fontColor`,
                  message: "Expected a non-empty fontColor string",
                });
              }
            }

            if (elem.fontFile !== undefined) {
              if (!isNonEmptyString(elem.fontFile)) {
                issues.push({
                  path: `${elemPath}.fontFile`,
                  message: "Expected a non-empty fontFile path string",
                });
              }
            }

            if (elem.maxWidth !== undefined) {
              if (!isFiniteNumber(elem.maxWidth) || elem.maxWidth <= 0) {
                issues.push({
                  path: `${elemPath}.maxWidth`,
                  message: `Expected a positive number, received ${elem.maxWidth}`,
                });
              }
            }

            if (elem.textAlign !== undefined) {
              const validAligns = ["left", "center", "right"];
              if (typeof elem.textAlign !== "string" || !validAligns.includes(elem.textAlign)) {
                issues.push({
                  path: `${elemPath}.textAlign`,
                  message: `Expected "left", "center", or "right", received ${JSON.stringify(elem.textAlign)}`,
                });
              }
            }

            if (elem.lineHeight !== undefined) {
              if (!isFiniteNumber(elem.lineHeight) || elem.lineHeight <= 0) {
                issues.push({
                  path: `${elemPath}.lineHeight`,
                  message: `Expected a positive number, received ${elem.lineHeight}`,
                });
              }
            }

            if (elem.stroke !== undefined) {
              if (!isObject(elem.stroke)) {
                issues.push({
                  path: `${elemPath}.stroke`,
                  message: "Expected a stroke object",
                });
              } else {
                if (!isNonEmptyString(elem.stroke.color)) {
                  issues.push({
                    path: `${elemPath}.stroke.color`,
                    message: "Expected a non-empty stroke color string",
                  });
                }
                if (!isFiniteNumber(elem.stroke.width) || elem.stroke.width < 0) {
                  issues.push({
                    path: `${elemPath}.stroke.width`,
                    message: `Expected a non-negative number, received ${elem.stroke.width}`,
                  });
                }
              }
            }

            if (elem.shadow !== undefined) {
              if (!isObject(elem.shadow)) {
                issues.push({
                  path: `${elemPath}.shadow`,
                  message: "Expected a shadow object",
                });
              } else {
                if (!isNonEmptyString(elem.shadow.color)) {
                  issues.push({
                    path: `${elemPath}.shadow.color`,
                    message: "Expected a non-empty shadow color string",
                  });
                }
                if (elem.shadow.x !== undefined && !isFiniteNumber(elem.shadow.x)) {
                  issues.push({
                    path: `${elemPath}.shadow.x`,
                    message: `Expected a finite number, received ${elem.shadow.x}`,
                  });
                }
                if (elem.shadow.y !== undefined && !isFiniteNumber(elem.shadow.y)) {
                  issues.push({
                    path: `${elemPath}.shadow.y`,
                    message: `Expected a finite number, received ${elem.shadow.y}`,
                  });
                }
              }
            }
          } else {
            issues.push({
              path: `${elemPath}.type`,
              message: `Expected "text", "image", or "video", received ${JSON.stringify(elem.type)}`,
            });
          }

          // Validate Animations
          if (elem.animation !== undefined) {
            const animPath = `${elemPath}.animation`;
            if (!isObject(elem.animation)) {
              issues.push({
                path: animPath,
                message: "Expected an animation object",
              });
            } else {
              const channels = ["opacity", "x", "y", "scale"] as const;
              for (const ch of channels) {
                const channelVal = elem.animation[ch];
                if (channelVal !== undefined) {
                  const chPath = `${animPath}.${ch}`;
                  if (!isObject(channelVal)) {
                    issues.push({
                      path: chPath,
                      message: `Expected an animation channel object for ${ch}`,
                    });
                  } else {
                    if (!isFiniteNumber(channelVal.duration) || channelVal.duration <= 0) {
                      issues.push({
                        path: `${chPath}.duration`,
                        message: `Expected a positive number, received ${channelVal.duration}`,
                      });
                    }

                    if (channelVal.delay !== undefined) {
                      if (!isFiniteNumber(channelVal.delay) || channelVal.delay < 0) {
                        issues.push({
                          path: `${chPath}.delay`,
                          message: `Expected a non-negative number, received ${channelVal.delay}`,
                        });
                      }
                    }

                    if (channelVal.easing !== undefined) {
                      const validEasings = ["linear", "easeIn", "easeOut", "easeInOut"];
                      if (typeof channelVal.easing !== "string" || !validEasings.includes(channelVal.easing)) {
                        issues.push({
                          path: `${chPath}.easing`,
                          message: `Expected "linear", "easeIn", "easeOut", or "easeInOut", received ${JSON.stringify(channelVal.easing)}`,
                        });
                      }
                    }

                    if (!isFiniteNumber(channelVal.from)) {
                      issues.push({
                        path: `${chPath}.from`,
                        message: `Expected a finite number, received ${channelVal.from}`,
                      });
                    }

                    if (!isFiniteNumber(channelVal.to)) {
                      issues.push({
                        path: `${chPath}.to`,
                        message: `Expected a finite number, received ${channelVal.to}`,
                      });
                    }

                    // Range specific rules for opacity and scale
                    if (ch === "opacity") {
                      if (isFiniteNumber(channelVal.from) && (channelVal.from < 0 || channelVal.from > 1)) {
                        issues.push({
                          path: `${chPath}.from`,
                          message: `Expected value between 0 and 1, received ${channelVal.from}`,
                        });
                      }
                      if (isFiniteNumber(channelVal.to) && (channelVal.to < 0 || channelVal.to > 1)) {
                        issues.push({
                          path: `${chPath}.to`,
                          message: `Expected value between 0 and 1, received ${channelVal.to}`,
                        });
                      }
                    }

                    if (ch === "scale") {
                      if (isFiniteNumber(channelVal.from) && channelVal.from < 0) {
                        issues.push({
                          path: `${chPath}.from`,
                          message: `Expected a non-negative number, received ${channelVal.from}`,
                        });
                      }
                      if (isFiniteNumber(channelVal.to) && channelVal.to < 0) {
                        issues.push({
                          path: `${chPath}.to`,
                          message: `Expected a non-negative number, received ${channelVal.to}`,
                        });
                      }
                    }
                  }
                }
              }
            }
          }
        });
      }
    }
  });

  if (issues.length > 0) {
    throw new KinoValidationError(issues);
  }
}
