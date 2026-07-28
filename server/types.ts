export type VerificationStatus =
  | "DRAFT"
  | "GENERATED"
  | "NEEDS_CONFIRMATION"
  | "SPEC_VERIFIED"
  | "CODE_VALIDATED"
  | "COMPILE_PASSED"
  | "HARDWARE_PENDING"
  | "USER_CONFIRMED"
  | "FAILED";

export type Source =
  | "user_provided"
  | "agent_recommendation"
  | "component_catalog"
  | "template_default"
  | "program_calculated"
  | "pending_confirmation";

export type Traced<T> = {
  value: T;
  source: Source;
  confidence: number;
  verification_status: VerificationStatus;
  notes: string;
};

export type ComponentSelection = {
  category: string;
  model: Traced<string>;
  operating_voltage: Traced<number | null>;
  logic_voltage: Traced<number | null>;
  max_current_ma: Traced<number | null>;
  interface: Traced<string>;
  pins: Record<string, number>;
  i2c_address: string | null;
  notes: string;
};

export type ProjectSpec = {
  schema_version: "1.0.0";
  project: {
    id: string;
    name: Traced<string>;
    description: Traced<string>;
    product_goal: Traced<string>;
    prototype_level: Traced<string>;
    status: VerificationStatus;
    created_at: string;
    updated_at: string;
  };
  user: {
    target_user: Traced<string>;
    experience_level: Traced<string>;
    preferred_language: Traced<string>;
  };
  scenario: {
    usage_environment: Traced<string>;
    usage_process: Traced<string[]>;
    frequency: Traced<string>;
    environmental_constraints: Traced<string[]>;
  };
  interaction: {
    user_actions: Traced<string[]>;
    system_inputs: Traced<string[]>;
    system_outputs: Traced<string[]>;
    feedback_methods: Traced<string[]>;
    abnormal_conditions: Traced<string[]>;
  };
  system: {
    functional_modules: Traced<string[]>;
    data_flow: Traced<string[]>;
    control_flow: Traced<string[]>;
    states: Traced<string[]>;
    safety_states: Traced<string[]>;
  };
  hardware: {
    preferred_controller: Traced<string>;
    controllers: ComponentSelection[];
    sensors: ComponentSelection[];
    actuators: ComponentSelection[];
    motor_drivers: ComponentSelection[];
    communication: {
      transport: Traced<string>;
      baud_rate: Traced<number>;
      protocol_version: string;
    };
    power_supply: {
      voltage: Traced<number | null>;
      rated_current_ma: Traced<number | null>;
      source_type: Traced<string>;
    };
    existing_components: Traced<string[]>;
  };
  software: {
    firmware_platform: Traced<string>;
    computer_language: Traced<string[]>;
    data_collection_required: Traced<boolean>;
    machine_learning_required: Traced<boolean>;
    control_interface_required: Traced<boolean>;
  };
  constraints: {
    budget_cny: Traced<number | null>;
    size_constraints: Traced<string>;
    power_constraints: Traced<string>;
    avoid_custom_pcb: Traced<boolean>;
    preferred_components: Traced<string[]>;
    forbidden_components: Traced<string[]>;
  };
  assumptions: Traced<string>[];
  open_questions: Traced<string>[];
  verification: {
    requirement_status: VerificationStatus;
    hardware_status: VerificationStatus;
    firmware_status: VerificationStatus;
    software_status: VerificationStatus;
    physical_test_status: VerificationStatus;
  };
};

export type ProjectCreateInput = {
  name: string;
  description: string;
  target_user?: string;
  usage_environment?: string;
  budget_cny?: number;
  experience_level?: string;
  preferred_controller?: string;
  communication_preference?: string;
  existing_components?: string[];
  size_constraints?: string;
  power_constraints?: string;
  prototype_level?: string;
  avoid_custom_pcb?: boolean;
  data_collection_required?: boolean;
  machine_learning_required?: boolean;
  control_interface_required?: boolean;
};

export type RequirementExtraction = {
  product_goal: string;
  target_user: string;
  usage_environment: string;
  usage_process: string[];
  user_actions: string[];
  system_inputs: string[];
  system_outputs: string[];
  feedback_methods: string[];
  abnormal_conditions: string[];
  functional_modules: string[];
  data_flow: string[];
  control_flow: string[];
  states: string[];
  safety_states: string[];
  preferred_controller: string;
  assumptions: string[];
  must_confirm_questions: string[];
  safety_flags: string[];
};

export type RequirementChange = {
  reply: string;
  should_update_spec: boolean;
  product_goal?: string | null;
  target_user?: string | null;
  usage_environment?: string | null;
  budget_cny?: number | null;
  preferred_controller?: string | null;
  data_collection_required?: boolean | null;
  machine_learning_required?: boolean | null;
  control_interface_required?: boolean | null;
  add_open_questions?: string[];
  resolved_open_questions?: string[];
  affected_modules?: string[];
  requires_confirmation?: boolean;
};

export type ArtifactDraft = {
  path: string;
  content: string;
  status?: VerificationStatus;
};

export interface WorkerEnv {
  ASSETS: Fetcher;
  DB: D1Database;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_BASE_URL?: string;
  DEEPSEEK_DEFAULT_MODEL?: string;
  DEEPSEEK_REASONING_MODEL?: string;
  DEEPSEEK_CODING_MODEL?: string;
  DEEPSEEK_REASONING_EFFORT?: string;
  MODEL_TIMEOUT_SECONDS?: string;
  MODEL_MAX_RETRIES?: string;
  MODEL_TEMPERATURE?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}
