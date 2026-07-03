<?php
namespace ElementorPro\Modules\CustomCode\AdminMenuItems;

use Elementor\Core\Admin\Menu\Interfaces\Admin_Menu_Item;
use Elementor\Settings;
use ElementorPro\Modules\CustomCode\Module as CustomCodeModule;
use ElementorPro\License\API;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

class Custom_Code_Menu_Item implements Admin_Menu_Item {

	const LICENSE_FEATURE_NAME = 'custom_code';

	public function get_capability(): string {
		return CustomCodeModule::CAPABILITY;
	}

	public function get_label(): string {
		return esc_html__( 'Custom Code', 'elementor-pro' );
	}

	public function get_parent_slug(): string {
		return Settings::PAGE_ID;
	}

	public function get_position(): ?int {
		return null;
	}

	public function is_visible(): bool {
		return API::is_licence_has_feature( static::LICENSE_FEATURE_NAME, API::BC_VALIDATION_CALLBACK );
	}
}
