<?php
namespace ElementorPro\Modules\DynamicTags\Tags\Base;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly
}

trait License_Meta_Trait {

	/**
	 * Get the license feature name required for this tag.
	 *
	 * @return string
	 */
	abstract protected function get_required_license_feature();

	/**
	 * Add license metadata to editor config.
	 *
	 * @return array
	 */
	public function get_editor_config() {
		$config = parent::get_editor_config();

		$config['meta'] = [
			'origin' => 'elementor',
			'required_license' => $this->get_required_license_feature(),
		];

		return $config;
	}
}

