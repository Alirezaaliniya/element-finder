<?php

namespace ElementorPro\Modules\Forms\Submissions\EditorOneMenuItems;

use Elementor\Core\Admin\EditorOneMenu\Interfaces\Menu_Item_Third_Level_Interface;
use Elementor\Modules\EditorOne\Classes\Menu_Config;
use ElementorPro\Modules\Forms\Submissions\AdminMenuItems\Submissions_Menu_Item;
use ElementorPro\Modules\Forms\Submissions\Component;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Editor_One_Submissions_Menu_Item extends Submissions_Menu_Item implements Menu_Item_Third_Level_Interface {

	public function get_position(): int {
		return 50;
	}

	public function get_slug(): string {
		return Component::PAGE_ID;
	}

	public function get_parent_slug(): string {
		return Menu_Config::ELEMENTOR_HOME_MENU_SLUG;
	}

	public function get_label(): string {
		return esc_html__( 'Submissions', 'elementor-pro' );
	}

	public function get_group_id(): string {
		return Menu_Config::EDITOR_GROUP_ID;
	}

	public function get_icon(): string {
		return 'send';
	}

	public function has_children(): bool {
		return false;
	}
}

