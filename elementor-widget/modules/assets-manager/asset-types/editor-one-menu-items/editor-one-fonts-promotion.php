<?php

namespace ElementorPro\Modules\AssetsManager\AssetTypes\EditorOneMenuItems;

use Elementor\Core\Admin\EditorOneMenu\Interfaces\Menu_Item_Interface;
use Elementor\Modules\EditorOne\Classes\Menu_Config;
use ElementorPro\Modules\AssetsManager\AssetTypes\AdminMenuItems\Custom_Fonts_Promotion_Menu_Item;
use ElementorPro\Modules\AssetsManager\AssetTypes\Fonts_Manager;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Editor_One_Fonts_Promotion extends Custom_Fonts_Promotion_Menu_Item implements Menu_Item_Interface {

	public function get_position(): int {
		return 10;
	}

	public function get_slug(): string {
		return Fonts_Manager::PROMOTION_MENU_SLUG;
	}

	public function get_parent_slug(): string {
		return Menu_Config::ELEMENTOR_MENU_SLUG;
	}

	public function get_label(): string {
		return esc_html__( 'Fonts', 'elementor-pro' );
	}

	public function get_group_id(): string {
		return Menu_Config::CUSTOM_ELEMENTS_GROUP_ID;
	}
}
